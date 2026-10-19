import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fx } from '../state/fx';
import type { FxEvent } from '../state/fx';
import type { Coord } from '../game/types';
import {
  BOARD_HALF,
  cellToWorld,
  ENEMY_BOARD_POS,
  LEGACY_MONOLITH_POSITION,
  LEGACY_MONOLITH_SCALE,
  PALETTE,
  PLAYER_BOARD_POS,
} from './config';
import type { BoardSide } from '../state/fx';
import { MISSILE_FLIGHT_MS } from '../state/fx';

interface Item {
  id: number;
  kind: FxEvent['type'];
  coord: Coord;
  big?: boolean;
  outcome?: 'miss' | 'hit';
  side: BoardSide;
}

let nextId = 1;

/** Expanding sonar ring. */
function Ripple({ pos, big, onDone }: { pos: [number, number]; big?: boolean; onDone: () => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const t = useRef(0);
  const finished = useRef(false);
  const life = 1.0;
  useFrame((_, dt) => {
    if (finished.current) return;
    t.current += dt;
    const p = t.current / life;
    if (p >= 1) {
      finished.current = true;
      onDone();
      return;
    }
    if (ref.current) {
      const s = 0.3 + p * (big ? 4.2 : 2.4);
      ref.current.scale.setScalar(s);
      const m = ref.current.material as THREE.MeshBasicMaterial;
      m.opacity = (1 - p) * 0.65;
    }
  });
  return (
    <mesh ref={ref} position={[pos[0], 0.09, pos[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.42, 0.5, 48]} />
      <meshBasicMaterial color={PALETTE.accent} transparent opacity={0.65} depthWrite={false} />
    </mesh>
  );
}

/** Particle burst — one Points object per burst, simulated in useFrame. */
function Burst({
  pos,
  color,
  count,
  speed,
  up,
  size,
  onDone,
}: {
  pos: [number, number];
  color: string;
  count: number;
  speed: number;
  up: number;
  size: number;
  onDone: () => void;
}) {
  const ref = useRef<THREE.Points>(null);
  const life = 1.15;
  const data = useRef<{ t: number; vel: Float32Array } | null>(null);

  if (!data.current) {
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.3 + Math.random() * 0.7);
      vel[i * 3] = Math.cos(a) * r;
      vel[i * 3 + 1] = up * (0.5 + Math.random() * 0.8);
      vel[i * 3 + 2] = Math.sin(a) * r;
    }
    data.current = { t: 0, vel };
  }

  const geo = useRef<THREE.BufferGeometry>(null);

  const burstDone = useRef(false);
  useFrame((_, dt) => {
    if (burstDone.current) return;
    const d = data.current!;
    d.t += dt;
    if (d.t >= life) {
      burstDone.current = true;
      onDone();
      return;
    }
    if (!geo.current) return;
    const posAttr = geo.current.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      posAttr.array[i * 3 + 1] = d.vel[i * 3 + 1] * d.t - 4.9 * d.t * d.t * 0.5;
      posAttr.array[i * 3] = d.vel[i * 3] * d.t;
      posAttr.array[i * 3 + 2] = d.vel[i * 3 + 2] * d.t;
    }
    posAttr.needsUpdate = true;
    const mat = ref.current?.material as THREE.PointsMaterial | undefined;
    if (mat) mat.opacity = 1 - d.t / life;
  });

  return (
    <points ref={ref} position={[pos[0], 0.15, pos[1]]}>
      <bufferGeometry ref={geo}>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(count * 3), 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={size} transparent opacity={0.95} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/** Brief point-light flash for explosions. */
function Flash({ pos, onDone }: { pos: [number, number]; onDone: () => void }) {
  const ref = useRef<THREE.PointLight>(null);
  const t = useRef(0);
  const finished = useRef(false);
  useFrame((_, dt) => {
    if (finished.current) return;
    t.current += dt;
    const p = t.current / 0.42;
    if (p >= 1) {
      finished.current = true;
      onDone();
      return;
    }
    if (ref.current) ref.current.intensity = (1 - p) * 28;
  });
  return <pointLight ref={ref} position={[pos[0], 0.8, pos[1]]} color={PALETTE.hitHot} intensity={28} distance={9} />;
}

function Missile({
  start,
  end,
  height,
  color,
  onDone,
}: {
  start: [number, number, number];
  end: [number, number, number];
  height: number;
  color: string;
  onDone: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const segments = useRef<(THREE.Mesh | null)[]>([]);
  const launchLight = useRef<THREE.PointLight>(null);
  const launchFlash = useRef<THREE.MeshBasicMaterial>(null);
  const launchFlashMesh = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const trailGeometry = useMemo(() => new THREE.CylinderGeometry(0.11, 0.16, 0.48, 10), []);
  const trailMaterials = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) =>
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 2.4,
          transparent: true,
          opacity: 0.86 * Math.pow(1 - index / 9, 1.7),
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    [color],
  );

  useEffect(
    () => () => {
      trailGeometry.dispose();
      trailMaterials.forEach((material) => material.dispose());
    },
    [trailGeometry, trailMaterials],
  );

  useFrame((_, dt) => {
    if (finished.current) return;
    elapsed.current += dt;
    const progress = Math.min(elapsed.current / (MISSILE_FLIGHT_MS / 1000), 1);
    const launchProgress = Math.min(elapsed.current / 0.18, 1);
    const pointAt = (p: number) =>
      new THREE.Vector3(
        THREE.MathUtils.lerp(start[0], end[0], p),
        THREE.MathUtils.lerp(start[1], end[1], p) + Math.sin(p * Math.PI) * height,
        THREE.MathUtils.lerp(start[2], end[2], p),
    );
    const current = pointAt(progress);
    const previous = pointAt(Math.max(0, progress - 0.015));
    if (ref.current) {
      ref.current.position.copy(current);
      ref.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), current.sub(previous).normalize());
    }
    segments.current.forEach((segment, index) => {
      if (!segment) return;
      const sample = progress - (index + 1) * 0.042;
      segment.visible = sample > 0;
      if (!segment.visible) return;
      const point = pointAt(sample);
      const before = pointAt(Math.max(0, sample - 0.02));
      const after = pointAt(Math.min(progress, sample + 0.02));
      segment.position.copy(point);
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), after.sub(before).normalize());
    });
    if (launchLight.current) launchLight.current.intensity = (1 - launchProgress) * 24;
    if (launchFlash.current) launchFlash.current.opacity = (1 - launchProgress) * 0.95;
    if (launchFlashMesh.current) launchFlashMesh.current.scale.setScalar(0.5 + launchProgress * 0.9);

    if (progress >= 1) {
      finished.current = true;
      onDone();
    }
  });

  return (
    <group>
      {trailMaterials.map((material, index) => (
        <mesh
          key={index}
          ref={(mesh) => { segments.current[index] = mesh; }}
          geometry={trailGeometry}
          material={material}
          visible={false}
          frustumCulled={false}
        />
      ))}
      <mesh ref={launchFlashMesh} position={start}>
        <sphereGeometry args={[0.42, 12, 10]} />
        <meshBasicMaterial ref={launchFlash} color={color} transparent opacity={0.95} toneMapped={false} depthWrite={false} />
      </mesh>
      <pointLight ref={launchLight} position={start} color={color} intensity={24} distance={5.5} />
      <group ref={ref}>
        <mesh>
          <capsuleGeometry args={[0.14, 0.34, 4, 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3.8} metalness={0.25} roughness={0.2} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <coneGeometry args={[0.18, 0.32, 10]} />
          <meshBasicMaterial color="#fff5df" toneMapped={false} />
        </mesh>
        <pointLight intensity={5} color={color} distance={4.5} />
      </group>
    </group>
  );
}

export function EffectsLayer() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(
    () =>
      fx.subscribe((e) => {
        if (e.type === 'marker') return; // markers come from board state, not fx
        setItems((cur) => [...cur, { id: nextId++, kind: e.type, coord: e.coord, big: 'big' in e ? e.big : false, side: e.side }]);
      }),
    [],
  );

  const done = useCallback((id: number) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  return (
    <group>
      {items.map((i) => {
        const base = i.side === 'player' ? PLAYER_BOARD_POS : ENEMY_BOARD_POS;
        const [cx, cz] = cellToWorld(i.coord);
        const pos: [number, number] = [cx + base[0], cz + base[2]];
        switch (i.kind) {
          case 'sonar':
            return <Ripple key={i.id} pos={pos} onDone={() => done(i.id)} />;
          case 'missile': {
            const launchX = cx + (cx >= 0 ? -3.2 : 3.2);
            const start: [number, number, number] =
              i.side === 'enemy'
                ? [launchX + PLAYER_BOARD_POS[0], 0.9, PLAYER_BOARD_POS[2] - BOARD_HALF + 0.15]
                : [
                    launchX,
                    LEGACY_MONOLITH_POSITION[1] + 4.05 * LEGACY_MONOLITH_SCALE[1],
                    LEGACY_MONOLITH_POSITION[2] + 1.2 * LEGACY_MONOLITH_SCALE[2],
                  ];
            const end: [number, number, number] = [pos[0], 0.2, pos[1]];
            return (
              <Missile
                key={i.id}
                start={start}
                end={end}
                height={5.1}
                color={i.side === 'enemy' ? PALETTE.accent : PALETTE.enemy}
                onDone={() => done(i.id)}
              />
            );
          }
          case 'splash':
            return (
              <group key={i.id}>
                <Flash pos={pos} onDone={() => {}} />
                <Ripple pos={pos} big={i.big} onDone={() => {}} />
                <Burst
                  pos={pos}
                  color={PALETTE.miss}
                  count={i.big ? 90 : 55}
                  speed={i.big ? 3.4 : 2.2}
                  up={i.big ? 4.2 : 3.0}
                  size={0.07}
                  onDone={() => done(i.id)}
                />
              </group>
            );
          case 'explosion':
            return (
              <group key={i.id}>
                <Flash pos={pos} onDone={() => {}} />
                <Burst pos={pos} color={PALETTE.hitHot} count={120} speed={3.6} up={3.4} size={0.09} onDone={() => done(i.id)} />
                <Burst pos={pos} color="#475569" count={50} speed={2.2} up={2.2} size={0.12} onDone={() => {}} />
              </group>
            );
          case 'sink':
            return (
              <group key={i.id}>
                <Ripple pos={pos} big onDone={() => {}} />
                <Burst pos={pos} color={PALETTE.accent} count={140} speed={4.4} up={4.8} size={0.1} onDone={() => done(i.id)} />
              </group>
            );
          default:
            return null;
        }
      })}
    </group>
  );
}
