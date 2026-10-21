import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GRID_SIZE } from '../game/types';
import type { CellMark } from '../game/types';
import { useGame } from '../state/store';
import { cellToWorld, PALETTE } from './config';
import { fxNow, makeParticleGeometry, makeParticleMaterial, rand } from './fxKit';

const tmp = new THREE.Object3D();
const MAX = GRID_SIZE * GRID_SIZE;
const POP = 0.55;

/** elastic overshoot 0 → 1 (Mario coin-pop feel) */
const popIn = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 + Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) * 0.9;
};

interface Cell {
  key: number;
  x: number;
  z: number;
  sunk: boolean;
}

/** which hit cells belong to already-sunk ships (marks identity tells us which board we are) */
const sunkSet = (marks: CellMark[][]): Set<number> => {
  const m = useGame.getState().match;
  const board = m?.player.marks === marks ? m.player : m?.enemy.marks === marks ? m.enemy : null;
  const out = new Set<number>();
  board?.ships.forEach((s) => s.sunk && s.cells.forEach((c) => out.add(c.y * GRID_SIZE + c.x)));
  return out;
};

const FIRE_PER_CELL = 12;
const SMOKE_PER_CELL = 7;

/** Looping fire + smoke columns over every hit; sunk wrecks only smoulder. */
function Burning({ cells }: { cells: Cell[] }) {
  const data = useMemo(() => {
    const burning = cells.filter((c) => !c.sunk);
    const fire = makeParticleGeometry(Math.max(1, burning.length * FIRE_PER_CELL), (i, o) => {
      const c = burning[Math.floor(i / FIRE_PER_CELL)];
      if (!c) {
        o.pos = [0, -50, 0];
        o.vel = [0, 0, 0];
        o.delay = 0;
        o.life = 1;
        o.size = 0;
        return;
      }
      o.pos = [c.x + rand(-0.16, 0.16), 0.36, c.z + rand(-0.16, 0.16)];
      o.vel = [rand(-0.08, 0.08), rand(0.7, 1.25), rand(-0.08, 0.08)];
      o.delay = rand(0, 1);
      o.life = rand(0.45, 0.8);
      o.size = rand(0.3, 0.48);
    });
    const smoke = makeParticleGeometry(Math.max(1, cells.length * SMOKE_PER_CELL), (i, o) => {
      const c = cells[Math.floor(i / SMOKE_PER_CELL)];
      if (!c) {
        o.pos = [0, -50, 0];
        o.vel = [0, 0, 0];
        o.delay = 0;
        o.life = 1;
        o.size = 0;
        return;
      }
      o.pos = [c.x + rand(-0.12, 0.12), c.sunk ? 0.12 : 0.6, c.z + rand(-0.12, 0.12)];
      o.vel = [rand(-0.06, 0.06), rand(0.45, 0.75), rand(-0.06, 0.06)];
      o.delay = rand(0, 3);
      o.life = rand(2.2, 3.2);
      o.size = c.sunk ? rand(0.4, 0.6) : rand(0.5, 0.75);
    });
    const fireMat = makeParticleMaterial(
      {
        colors: ['#fff1c4', '#ff8a2a', '#b3200b'],
        additive: true,
        loop: true,
        sizeStart: 1,
        sizeEnd: 0.25,
        soft: 1.3,
        fadeIn: 0.12,
        opacity: 0.9,
      },
      0,
    );
    const smokeMat = makeParticleMaterial(
      {
        colors: ['#3a3430', '#2a2d33', '#4c535d'],
        loop: true,
        sizeStart: 0.55,
        sizeEnd: 1.9,
        soft: 1.5,
        fadeIn: 0.15,
        opacity: 0.55,
        wind: [0.12, 0, -0.18],
      },
      0,
    );
    return { fire, smoke, fireMat, smokeMat, any: burning.length > 0, anySmoke: cells.length > 0 };
  }, [cells]);

  useEffect(
    () => () => {
      data.fire.dispose();
      data.smoke.dispose();
      data.fireMat.dispose();
      data.smokeMat.dispose();
    },
    [data],
  );

  return (
    <group>
      {data.anySmoke && <points geometry={data.smoke} material={data.smokeMat} frustumCulled={false} />}
      {data.any && <points geometry={data.fire} material={data.fireMat} frustumCulled={false} renderOrder={2} />}
    </group>
  );
}

/**
 * Hit/miss markers for a whole board. Instanced meshes keep it to a handful of
 * draw calls; each new marker pops in with an elastic bounce and a flash ring.
 */
export function MarkerField({ marks, version }: { marks: CellMark[][]; version: number }) {
  const missPeg = useRef<THREE.InstancedMesh>(null);
  const missRing = useRef<THREE.InstancedMesh>(null);
  const hitPeg = useRef<THREE.InstancedMesh>(null);
  const hitRing = useRef<THREE.InstancedMesh>(null);
  const hitRingMat = useRef<THREE.MeshBasicMaterial>(null);
  const hitPegMat = useRef<THREE.MeshStandardMaterial>(null);
  const born = useRef(new Map<number, number>());

  const { misses, hits } = useMemo(() => {
    const misses: Cell[] = [];
    const hits: Cell[] = [];
    const sunk = sunkSet(marks);
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++) {
        const key = y * GRID_SIZE + x;
        const [wx, wz] = cellToWorld({ x, y });
        if (marks[y][x] === 'miss') misses.push({ key, x: wx, z: wz, sunk: false });
        else if (marks[y][x] === 'hit') hits.push({ key, x: wx, z: wz, sunk: sunk.has(key) });
      }
    return { misses, hits };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, version]);

  // forget markers on a fresh board so the next match pops them again
  useEffect(() => {
    const live = new Set([...misses, ...hits].map((c) => c.key));
    for (const k of born.current.keys()) if (!live.has(k)) born.current.delete(k);
    const now = fxNow();
    // first render of an in-progress board (e.g. remount) should not replay every pop
    const fresh = born.current.size === 0 && live.size > 1;
    for (const c of [...misses, ...hits]) if (!born.current.has(c.key)) born.current.set(c.key, fresh ? -99 : now);
  }, [misses, hits]);

  const fireCells = useMemo(() => hits, [hits]);

  useFrame(() => {
    const now = fxNow();
    const place = (
      mesh: THREE.InstancedMesh | null,
      cells: Cell[],
      y: number,
      flat: boolean,
      scaleAt: (age: number, c: Cell) => number,
    ) => {
      if (!mesh) return;
      cells.forEach((c, i) => {
        const age = now - (born.current.get(c.key) ?? now);
        const s = scaleAt(age, c);
        tmp.position.set(c.x, y + (flat ? 0 : Math.max(0, 1 - age / 0.25) * 0.6), c.z);
        tmp.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
        tmp.scale.setScalar(Math.max(0.0001, s));
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      });
      mesh.count = cells.length;
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(missPeg.current, misses, 0.12, false, (a) => popIn(a / POP));
    place(missRing.current, misses, 0.065, true, (a) => popIn((a - 0.08) / POP));
    place(hitPeg.current, hits, 0.16, false, (a, c) => popIn(a / POP) * (c.sunk ? 0.75 : 1));
    place(hitRing.current, hits, 0.075, true, (a) => popIn((a - 0.05) / POP) * (1 + 0.06 * Math.sin(now * 4 + a)));
    if (hitRingMat.current) hitRingMat.current.opacity = 0.65 + Math.sin(now * 5) * 0.2;
    if (hitPegMat.current) hitPegMat.current.emissiveIntensity = 1.8 + Math.sin(now * 6) * 0.6;
  });

  return (
    <group>
      {/* miss: white peg + soft ring, classic Battleship */}
      <instancedMesh ref={missPeg} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <cylinderGeometry args={[0.09, 0.11, 0.16, 14]} />
        <meshStandardMaterial color="#f1f7ff" emissive="#9cc7ff" emissiveIntensity={0.35} roughness={0.45} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={missRing} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <ringGeometry args={[0.2, 0.3, 28]} />
        <meshBasicMaterial color={PALETTE.miss} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {/* hit: hot peg + pulsing danger ring */}
      <instancedMesh ref={hitPeg} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <cylinderGeometry args={[0.1, 0.12, 0.2, 14]} />
        <meshStandardMaterial
          ref={hitPegMat}
          color="#ff6b3d"
          emissive="#ff4d1a"
          emissiveIntensity={1.8}
          roughness={0.4}
          metalness={0.1}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={hitRing} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <ringGeometry args={[0.3, 0.4, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial
          ref={hitRingMat}
          color={PALETTE.hitHot}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
      <Burning cells={fireCells} />
    </group>
  );
}
