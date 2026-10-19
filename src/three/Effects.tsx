import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fx } from '../state/fx';
import type { FxEvent } from '../state/fx';
import type { Coord } from '../game/types';
import { cellToWorld, PALETTE } from './config';

interface Item {
  id: number;
  kind: FxEvent['type'];
  coord: Coord;
  big?: boolean;
  outcome?: 'miss' | 'hit';
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
    const p = t.current / 0.5;
    if (p >= 1) {
      finished.current = true;
      onDone();
      return;
    }
    if (ref.current) ref.current.intensity = (1 - p) * 14;
  });
  return <pointLight ref={ref} position={[pos[0], 0.8, pos[1]]} color={PALETTE.hitHot} intensity={14} distance={7} />;
}

export function EffectsLayer() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(
    () =>
      fx.subscribe((e) => {
        if (e.type === 'marker') return; // markers come from board state, not fx
        setItems((cur) => [...cur, { id: nextId++, kind: e.type, coord: e.coord, big: 'big' in e ? e.big : false }]);
      }),
    [],
  );

  const done = useCallback((id: number) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  return (
    <group>
      {items.map((i) => {
        const pos = cellToWorld(i.coord);
        switch (i.kind) {
          case 'sonar':
            return <Ripple key={i.id} pos={pos} onDone={() => done(i.id)} />;
          case 'splash':
            return (
              <group key={i.id}>
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
