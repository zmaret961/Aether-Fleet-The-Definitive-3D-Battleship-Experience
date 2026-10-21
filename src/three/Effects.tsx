import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fx, MISSILE_FLIGHT_MS } from '../state/fx';
import type { BoardSide } from '../state/fx';
import { useGame } from '../state/store';
import { cellToWorld, LEGACY_MONOLITH_POSITION, LEGACY_MONOLITH_SCALE, PALETTE, PLAYER_BOARD_POS } from './config';
import {
  addTrauma,
  burstGeometry,
  cellWorld,
  DEBRIS,
  FIREBALL,
  flashLight,
  fxNow,
  fxUniforms,
  LIGHT_POOL_SIZE,
  lightSlots,
  makeParticleGeometry,
  makeParticleMaterial,
  MIST,
  rand,
  shipAt,
  SMOKE,
  SPARKS,
  takeTrauma,
  WATER_COLUMN,
  WATER_CROWN,
} from './fxKit';
import type { BurstSpec } from './fxKit';

const FLIGHT = MISSILE_FLIGHT_MS / 1000;

type Kind = 'sonar' | 'missile' | 'splash' | 'explosion' | 'sink';

interface Item {
  id: number;
  kind: Kind;
  birth: number;
  life: number;
  side: BoardSide;
  pos: THREE.Vector3;
  start?: THREE.Vector3;
  cells?: THREE.Vector3[];
}

let nextId = 1;

// ------------------------------------------------------------------ primitives

/** GPU particle burst — positions are solved in the shader from `birth`. */
export function Burst({
  spec,
  birth,
  position = [0, 0, 0],
}: {
  spec: BurstSpec;
  birth: number;
  position?: [number, number, number];
}) {
  const geometry = useMemo(() => burstGeometry(spec), [spec]);
  const material = useMemo(() => makeParticleMaterial(spec, birth), [spec, birth]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <points geometry={geometry} material={material} position={position} frustumCulled={false} />;
}

/** Flat expanding ring on the water (shockwave, ripple, foam disc). */
export function Ring({
  birth,
  life,
  from,
  to,
  color,
  opacity = 0.8,
  inner = 0.82,
  y = 0.1,
  additive = true,
  position = [0, 0, 0],
}: {
  birth: number;
  life: number;
  from: number;
  to: number;
  color: string;
  opacity?: number;
  inner?: number;
  y?: number;
  additive?: boolean;
  position?: [number, number, number];
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!mesh.current || !mat.current) return;
    const p = (fxNow() - birth) / life;
    mesh.current.visible = p >= 0 && p <= 1;
    if (!mesh.current.visible) return;
    const e = 1 - Math.pow(1 - p, 3);
    mesh.current.scale.setScalar(from + (to - from) * e);
    mat.current.opacity = opacity * (1 - p) * (1 - p);
  });
  return (
    <mesh ref={mesh} position={[position[0], y, position[2]]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[inner, 1, 48]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </mesh>
  );
}

/** Hot core flash: an additive sphere that pops then fades. */
function Glow({
  birth,
  life,
  size,
  color,
  position,
}: {
  birth: number;
  life: number;
  size: number;
  color: string;
  position: [number, number, number];
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!mesh.current || !mat.current) return;
    const p = (fxNow() - birth) / life;
    mesh.current.visible = p >= 0 && p <= 1;
    if (!mesh.current.visible) return;
    mesh.current.scale.setScalar(size * (0.35 + Math.sqrt(p) * 0.9));
    mat.current.opacity = Math.pow(1 - p, 2);
  });
  return (
    <mesh ref={mesh} position={position} visible={false}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ------------------------------------------------------------------ compositions

const scaled = (spec: BurstSpec, k: number, extra: Partial<BurstSpec> = {}): BurstSpec => ({
  ...spec,
  count: Math.round(spec.count * k),
  ...extra,
});

const MINI_FIREBALL = scaled(FIREBALL, 0.6, { size: [0.55, 0.95] });
const MINI_SPARKS = scaled(SPARKS, 0.45);
const BIG_COLUMN = scaled(WATER_COLUMN, 1.8, { up: [5.5, 9.0], spread: 0.6, life: [1.2, 1.8], size: [0.16, 0.34] });
const BIG_SMOKE = scaled(SMOKE, 1.9, {
  life: [2.8, 4.4],
  up: [1.1, 2.0],
  size: [0.9, 1.5],
  spread: 0.9,
  delay: [0.2, 1.4],
  colors: ['#2b2420', '#1f2227', '#454b54'],
});
const EMBERS: BurstSpec = {
  count: 40, life: [1.2, 2.2], speed: [0.3, 1.0], up: [1.4, 2.6], size: [0.05, 0.09], spread: 0.6, delay: [0, 1.2],
  shape: 'ring', drag: 0.8, colors: ['#fff1c2', '#ff9d3d', '#ff4d1a'], additive: true, soft: 0.6, wind: [0.2, 0, -0.1],
};
const CHURN: BurstSpec = {
  count: 26, life: [1.4, 2.4], speed: [0.1, 0.4], up: [0.1, 0.35], size: [0.18, 0.3], spread: 0.35, delay: [0.2, 2.6],
  shape: 'ring', sizeStart: 0.6, sizeEnd: 1.6, colors: ['#ffffff', '#d6f0ff', '#90c6e6'], opacity: 0.55, soft: 1.4,
};
const MUZZLE_SMOKE = scaled(SMOKE, 0.7, { life: [0.9, 1.5], size: [0.4, 0.7], delay: [0, 0.1], colors: ['#d9dee6', '#a1a9b4', '#5d6670'], opacity: 0.45 });

function Explosion({ item }: { item: Item }) {
  const { birth, pos, side } = item;
  const y = side === 'player' ? 0.45 : 0.25;
  const p: [number, number, number] = [pos.x, y, pos.z];
  return (
    <group>
      <Glow birth={birth} life={0.32} size={1.15} color="#fff3d6" position={p} />
      <Burst spec={FIREBALL} birth={birth} position={p} />
      <Burst spec={SPARKS} birth={birth} position={p} />
      <Burst spec={DEBRIS} birth={birth} position={p} />
      <Burst spec={SMOKE} birth={birth} position={p} />
      <Ring birth={birth} life={0.7} from={0.3} to={2.2} color="#ffb46b" opacity={0.5} inner={0.9} position={p} />
      <Ring birth={birth + 0.05} life={1.3} from={0.4} to={1.9} color="#dff3ff" opacity={0.35} inner={0.7} position={p} />
    </group>
  );
}

function Splash({ item }: { item: Item }) {
  const { birth, pos } = item;
  const p: [number, number, number] = [pos.x, 0.1, pos.z];
  return (
    <group>
      <Burst spec={WATER_COLUMN} birth={birth} position={p} />
      <Burst spec={WATER_CROWN} birth={birth} position={p} />
      <Burst spec={MIST} birth={birth} position={p} />
      <Ring birth={birth} life={0.5} from={0.05} to={0.75} color="#ffffff" opacity={0.6} inner={0} position={p} />
      <Ring birth={birth} life={1.2} from={0.3} to={2.4} color="#e8f7ff" opacity={0.7} inner={0.88} position={p} />
      <Ring birth={birth + 0.22} life={1.3} from={0.2} to={1.7} color="#bfe6ff" opacity={0.45} inner={0.86} position={p} />
    </group>
  );
}

const SINK_STAGGER = 0.17;

function SinkSequence({ item }: { item: Item }) {
  const { birth, pos } = item;
  const cells = item.cells ?? [pos];
  const center = cells.reduce((acc, c) => acc.add(c), new THREE.Vector3()).multiplyScalar(1 / cells.length);
  const end = birth + cells.length * SINK_STAGGER;
  const c: [number, number, number] = [center.x, 0.2, center.z];
  return (
    <group>
      {cells.map((cell, i) => {
        const b = birth + i * SINK_STAGGER;
        const p: [number, number, number] = [cell.x, 0.4, cell.z];
        return (
          <group key={i}>
            <Glow birth={b} life={0.28} size={0.9} color="#fff1cf" position={p} />
            <Burst spec={MINI_FIREBALL} birth={b} position={p} />
            <Burst spec={MINI_SPARKS} birth={b} position={p} />
            <Burst spec={CHURN} birth={b} position={[cell.x, 0.1, cell.z]} />
          </group>
        );
      })}
      <Glow birth={end} life={0.45} size={2.1} color="#fff6e0" position={[center.x, 0.6, center.z]} />
      <Burst spec={FIREBALL} birth={end} position={[center.x, 0.5, center.z]} />
      <Burst spec={BIG_COLUMN} birth={end} position={c} />
      <Burst spec={DEBRIS} birth={end} position={c} />
      <Burst spec={EMBERS} birth={end} position={c} />
      <Burst spec={BIG_SMOKE} birth={end} position={c} />
      <Ring birth={end} life={1.0} from={0.5} to={5.2} color="#ffc07a" opacity={0.9} inner={0.9} position={c} />
      <Ring birth={end + 0.1} life={2.2} from={0.8} to={4.0} color="#dff3ff" opacity={0.5} inner={0.8} position={c} />
    </group>
  );
}

function Sonar({ item }: { item: Item }) {
  const p: [number, number, number] = [item.pos.x, 0.09, item.pos.z];
  return (
    <group>
      <Ring birth={item.birth} life={0.9} from={0.25} to={1.3} color={PALETTE.accent} opacity={0.75} inner={0.84} position={p} />
      <Ring birth={item.birth + 0.12} life={0.9} from={0.2} to={0.9} color={PALETTE.accent} opacity={0.5} inner={0.8} position={p} />
    </group>
  );
}

/** Shrinking red lock-on brackets over your own fleet while the boss's missile is inbound. */
function IncomingWarning({ birth, pos }: { birth: number; pos: THREE.Vector3 }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!g.current || !mat.current) return;
    const p = (fxNow() - birth) / FLIGHT;
    g.current.visible = p >= 0 && p <= 1;
    g.current.scale.setScalar(1.7 - p * 1.15);
    g.current.rotation.y = p * Math.PI * 0.75;
    mat.current.opacity = (0.55 + 0.45 * Math.sign(Math.sin(p * 38))) * 0.9;
  });
  return (
    <group ref={g} position={[pos.x, 0.55, pos.z]}>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <ringGeometry args={[0.5, 0.58, 4]} />
        <meshBasicMaterial ref={mat} color="#ff3b4f" transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

const UP = new THREE.Vector3(0, 1, 0);

function Missile({ item }: { item: Item }) {
  const { birth, side } = item;
  const start = item.start!;
  const end = useMemo(() => new THREE.Vector3(item.pos.x, 0.22, item.pos.z), [item.pos]);
  const color = side === 'enemy' ? PALETTE.accent : PALETTE.enemy;
  const height = side === 'enemy' ? 5.4 : 3.2;
  const body = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);

  const pointAt = useMemo(() => {
    const v = new THREE.Vector3();
    return (p: number, out = v) =>
      out.set(
        THREE.MathUtils.lerp(start.x, end.x, p),
        THREE.MathUtils.lerp(start.y, end.y, p) + Math.sin(p * Math.PI) * height,
        THREE.MathUtils.lerp(start.z, end.z, p),
      );
  }, [start, end, height]);

  const trail = useMemo(() => {
    const smokeN = 150;
    const hotN = 70;
    const tmp = new THREE.Vector3();
    const smoke = makeParticleGeometry(smokeN, (i, o) => {
      const p = i / smokeN;
      pointAt(p, tmp);
      o.pos = [tmp.x, tmp.y, tmp.z];
      o.vel = [rand(-0.18, 0.18), rand(0.05, 0.25), rand(-0.18, 0.18)];
      o.delay = p * FLIGHT;
      o.life = rand(0.9, 1.6);
      o.size = rand(0.16, 0.26);
    });
    const hot = makeParticleGeometry(hotN, (i, o) => {
      const p = i / hotN;
      pointAt(p, tmp);
      o.pos = [tmp.x, tmp.y, tmp.z];
      o.vel = [rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1)];
      o.delay = p * FLIGHT;
      o.life = rand(0.16, 0.3);
      o.size = rand(0.26, 0.38);
    });
    const smokeMat = makeParticleMaterial(
      {
        colors: ['#f4f7fb', '#c3ccd8', '#6f7987'],
        opacity: 0.32,
        sizeStart: 0.7,
        sizeEnd: 3.2,
        drag: 1.4,
        soft: 2.2,
        fadeIn: 0.02,
      },
      birth,
    );
    const hotMat = makeParticleMaterial(
      { colors: ['#ffffff', color, '#ff5a1a'], additive: true, sizeStart: 1, sizeEnd: 0.25, soft: 1.1, fadeIn: 0.01 },
      birth,
    );
    return { smoke, hot, smokeMat, hotMat };
  }, [pointAt, birth, color]);

  useEffect(
    () => () => {
      trail.smoke.dispose();
      trail.hot.dispose();
      trail.smokeMat.dispose();
      trail.hotMat.dispose();
    },
    [trail],
  );

  useEffect(() => {
    flashLight({ pos: start.clone(), color, peak: 18, life: 0.3, distance: 7 });
    flashLight({ pos: start.clone(), color, peak: 7, life: FLIGHT, distance: 6, follow: body.current });
  }, [start, color]);

  const cur = useMemo(() => new THREE.Vector3(), []);
  const prev = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!body.current) return;
    const p = (fxNow() - birth) / FLIGHT;
    body.current.visible = p >= 0 && p < 1;
    if (!body.current.visible) return;
    pointAt(p, cur);
    pointAt(Math.max(0, p - 0.01), prev);
    body.current.position.copy(cur);
    if (p > 0.005) body.current.quaternion.setFromUnitVectors(UP, cur.clone().sub(prev).normalize());
    if (flame.current) {
      const f = 0.8 + Math.random() * 0.45;
      flame.current.scale.set(f, 0.8 + Math.random() * 0.7, f);
    }
  });

  return (
    <group>
      <points geometry={trail.smoke} material={trail.smokeMat} frustumCulled={false} />
      <points geometry={trail.hot} material={trail.hotMat} frustumCulled={false} />
      <Glow birth={birth} life={0.25} size={0.9} color={color} position={[start.x, start.y, start.z]} />
      <Burst spec={MUZZLE_SMOKE} birth={birth} position={[start.x, start.y, start.z]} />
      {side === 'player' && <IncomingWarning birth={birth} pos={item.pos} />}
      <group ref={body} visible={false} scale={1.55}>
        {/* fuselage */}
        <mesh>
          <cylinderGeometry args={[0.07, 0.075, 0.5, 12]} />
          <meshStandardMaterial color="#e8edf3" metalness={0.3} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.076, 0.076, 0.07, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <coneGeometry args={[0.07, 0.2, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} roughness={0.3} />
        </mesh>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} position={[Math.cos((k * Math.PI) / 2) * 0.09, -0.19, Math.sin((k * Math.PI) / 2) * 0.09]} rotation={[0, -(k * Math.PI) / 2, 0]}>
            <boxGeometry args={[0.09, 0.13, 0.012]} />
            <meshStandardMaterial color="#9aa6b4" metalness={0.3} roughness={0.4} />
          </mesh>
        ))}
        {/* exhaust flame */}
        <mesh ref={flame} position={[0, -0.36, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.065, 0.28, 10]} />
          <meshBasicMaterial color="#fff1c9" transparent opacity={0.95} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh position={[0, -0.3, 0]}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ layer

const LIFE: Record<Kind, number> = {
  sonar: 1.2,
  missile: FLIGHT + 1.8,
  splash: 2.2,
  explosion: 3.4,
  sink: 6.5,
};

function missileStart(side: BoardSide, coord: { x: number; y: number }): THREE.Vector3 {
  const [cx] = cellToWorld(coord);
  if (side === 'player') {
    // the boss fires from the hatch on top of its cabinet
    return new THREE.Vector3(
      LEGACY_MONOLITH_POSITION[0] + cx * 0.3,
      LEGACY_MONOLITH_POSITION[1] + 5.95 * LEGACY_MONOLITH_SCALE[1],
      LEGACY_MONOLITH_POSITION[2] + 0.2 * LEGACY_MONOLITH_SCALE[2],
    );
  }
  // your fleet fires: launch from the surviving ship closest to the target column
  const m = useGame.getState().match;
  const alive = m?.player.ships.filter((s) => !s.sunk) ?? [];
  let best: THREE.Vector3 | null = null;
  let bestD = Infinity;
  for (const s of alive) {
    const mid = s.cells[Math.floor(s.cells.length / 2)];
    const w = cellWorld('player', mid);
    const d = Math.abs(w.x - cx) + (w.z - PLAYER_BOARD_POS[2]) * 0.15;
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  if (best) return best.setY(0.62);
  return new THREE.Vector3(cx + (cx >= 0 ? -3.2 : 3.2), 0.9, PLAYER_BOARD_POS[2] - 4.85);
}

export function EffectsLayer() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const shakeOffset = useRef(new THREE.Vector3());
  const camera = useThree((s) => s.camera);
  const size = useRef(new THREE.Vector2());

  useEffect(
    () =>
      fx.subscribe((e) => {
        if (e.type === 'marker' || e.type === 'bossMood') return; // markers come from board state, not fx
        const birth = fxNow();
        const pos = cellWorld(e.side, e.coord);
        const item: Item = { id: nextId++, kind: e.type, birth, life: LIFE[e.type], side: e.side, pos };
        const reduced = useGame.getState().settings.reducedMotion;
        const k = reduced ? 0.25 : 1;
        switch (e.type) {
          case 'missile':
            item.start = missileStart(e.side, e.coord);
            break;
          case 'explosion':
            flashLight({ pos: pos.clone().setY(1.0), color: '#ffab47', peak: 42, life: 0.55, distance: 12 });
            addTrauma((e.side === 'player' ? 0.5 : 0.36) * k);
            break;
          case 'splash':
            flashLight({ pos: pos.clone().setY(0.8), color: '#bfe6ff', peak: 7, life: 0.4, distance: 6 });
            addTrauma(0.08 * k);
            break;
          case 'sink': {
            const ship = shipAt(e.side, e.coord);
            item.cells = ship ? ship.cells.map((c) => cellWorld(e.side, c)) : [pos];
            const cells = item.cells;
            cells.forEach((c, i) =>
              window.setTimeout(() => {
                flashLight({ pos: c.clone().setY(1.0), color: '#ff9a3c', peak: 26, life: 0.35, distance: 9 });
                addTrauma(0.16 * k);
              }, i * SINK_STAGGER * 1000),
            );
            window.setTimeout(() => {
              const mid = cells[Math.floor(cells.length / 2)];
              flashLight({ pos: mid.clone().setY(1.6), color: '#ffb35c', peak: 70, life: 0.9, distance: 16 });
              addTrauma(0.75 * k);
            }, cells.length * SINK_STAGGER * 1000);
            break;
          }
        }
        setItems((cur) => [...cur, item]);
      }),
    [],
  );

  useFrame(({ clock, gl }, dt) => {
    fxUniforms.uTime.value = clock.elapsedTime;
    gl.getDrawingBufferSize(size.current);
    fxUniforms.uResY.value = size.current.y;

    const now = clock.elapsedTime;
    if (itemsRef.current.some((i) => now - i.birth > i.life)) {
      setItems((cur) => cur.filter((i) => now - i.birth <= i.life));
    }

    // pooled flash lights — fixed count so no shader recompiles
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const L = lights.current[i];
      const req = lightSlots[i];
      if (!L) continue;
      if (!req) {
        L.intensity = 0;
        continue;
      }
      const p = (now - req.birth) / req.life;
      if (p < 0 || p > 1) {
        L.intensity = 0;
        continue;
      }
      L.intensity = req.peak * (1 - p) * (1 - p);
      L.color.set(req.color);
      L.distance = req.distance;
      if (req.follow && req.follow.visible) req.follow.getWorldPosition(L.position);
      else if (!req.follow) L.position.copy(req.pos);
      else L.intensity = 0;
    }

    // camera trauma shake (undo last frame's offset, apply a new one)
    camera.position.sub(shakeOffset.current);
    const t = takeTrauma(dt);
    const s = t * t * 0.55;
    shakeOffset.current.set(
      Math.sin(now * 61.3) * s + Math.sin(now * 23.1) * s * 0.5,
      Math.sin(now * 53.7 + 1.3) * s * 0.7,
      Math.sin(now * 47.9 + 2.1) * s * 0.4,
    );
    camera.position.add(shakeOffset.current);
  });

  return (
    <group>
      {Array.from({ length: LIGHT_POOL_SIZE }).map((_, i) => (
        <pointLight key={i} ref={(l) => { lights.current[i] = l; }} intensity={0} distance={10} decay={2} />
      ))}
      {items.map((i) => {
        switch (i.kind) {
          case 'sonar':
            return <Sonar key={i.id} item={i} />;
          case 'missile':
            return <Missile key={i.id} item={i} />;
          case 'splash':
            return <Splash key={i.id} item={i} />;
          case 'explosion':
            return <Explosion key={i.id} item={i} />;
          case 'sink':
            return <SinkSequence key={i.id} item={i} />;
          default:
            return null;
        }
      })}
    </group>
  );
}
