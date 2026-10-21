import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FLEET } from '../game/types';
import type { PlacedShip } from '../game/types';
import { useGame } from '../state/store';
import type { Phase } from '../state/store';
import { cellToWorld } from './config';
import { ShipMesh } from './ShipMesh';

/** Echelon formation (world x, z, heading) — Devin's carrier leads the column. */
const FORMATION: Record<string, [number, number, number]> = {
  carrier: [0.4, -1.2, 0.18],
  battleship: [-4.6, 2.0, 0.2],
  cruiser: [4.2, 2.6, 0.16],
  submarine: [-1.6, 5.4, 0.22],
  destroyer: [6.8, -3.6, 0.14],
};
const HERO_SCALE = 1.3;
/** Hull sits in the swell (ocean rest height is -0.42). */
const WATERLINE = -0.62;

const heroShips: PlacedShip[] = FLEET.map((spec) => ({
  spec,
  cells: Array.from({ length: spec.length }, (_, i) => ({ x: i, y: 0 })),
  hits: 0,
  sunk: false,
}));

function HeroShip({ ship }: { ship: PlacedShip }) {
  const [x, z, heading] = FORMATION[ship.spec.id] ?? [0, 0, 0];
  // ShipMesh centres itself on its board cells; cancel that so it sits at the formation slot
  const [cx] = cellToWorld({ x: (ship.spec.length - 1) / 2, y: 0 });
  const [, cz] = cellToWorld({ x: 0, y: 0 });
  return (
    <group position={[x, WATERLINE, z]} rotation={[0, heading, 0]} scale={HERO_SCALE}>
      <group position={[-cx, 0, -cz]}>
        <ShipMesh ship={ship} underway />
      </group>
    </group>
  );
}

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#031a0c';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#5dff9a';
    g.shadowColor = '#5dff9a';
    g.shadowBlur = 12;
    // scowling brows + slit eyes + jagged grin
    g.save();
    g.translate(78, 52);
    g.rotate(0.28);
    g.fillRect(-34, -6, 68, 12);
    g.restore();
    g.save();
    g.translate(178, 52);
    g.rotate(-0.28);
    g.fillRect(-34, -6, 68, 12);
    g.restore();
    g.fillRect(60, 70, 40, 10);
    g.fillRect(156, 70, 40, 10);
    g.beginPath();
    g.moveTo(56, 108);
    for (let i = 0; i <= 8; i++) g.lineTo(56 + i * 18, i % 2 ? 128 : 108);
    g.lineTo(200, 108);
    g.lineWidth = 6;
    g.strokeStyle = '#5dff9a';
    g.stroke();
    g.font = '700 13px monospace';
    g.fillText('PROCEDURE DIVISION.', 58, 150);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The Legacy Monolith on the horizon: a fogged mainframe silhouette whose CRT
 * scowl and beacon read through the haze. Cheap stand-in for the full boss.
 */
/** Per-screen horizon spot (world x, z) that keeps the boss clear of the menu cards. */
const SILHOUETTE_SPOT: Partial<Record<Phase, [number, number]>> & { menu: [number, number] } = {
  menu: [-51.8, -61.5],
  howto: [34.2, -72.4],
  commander: [-7.9, -85.1],
  difficulty: [-19.4, -79.7],
};
const tmp = new THREE.Vector3();

function MonolithSilhouette() {
  const face = useMemo(faceTexture, []);
  useEffect(() => () => face.dispose(), [face]);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const t = performance.now() / 1000;
    if (beacon.current) beacon.current.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(t * 2.4)) ** 6;
    if (screen.current) screen.current.color.setScalar(0.7 + Math.sin(t * 13) * 0.03 + (Math.sin(t * 0.7) > 0.97 ? -0.4 : 0));
  });
  // unfogged ink silhouette so it reads against the lit horizon band
  const ink = useMemo(() => new THREE.MeshBasicMaterial({ color: '#061220', fog: false }), []);
  const rim = useMemo(() => new THREE.MeshBasicMaterial({ color: '#1d4a66', fog: false }), []);
  const root = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const spot = SILHOUETTE_SPOT[useGame.getState().phase] ?? SILHOUETTE_SPOT.menu;
    // drift to each screen's spot (masked by the camera move) and always face the lens
    g.position.lerp(tmp.set(spot[0], -0.6, spot[1]), 1 - Math.exp(-Math.min(dt, 0.1) * 1.2));
    g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
  });
  return (
    <group ref={root} position={[SILHOUETTE_SPOT.menu[0], -0.6, SILHOUETTE_SPOT.menu[1]]} scale={0.72}>
      <mesh position={[0, 14.04, 0]} material={rim}>
        <boxGeometry args={[9.9, 0.08, 6.9]} />
      </mesh>
      <mesh position={[0, 7, 0]} material={ink}>
        <boxGeometry args={[9, 14, 6]} />
      </mesh>
      <mesh position={[0, 14.5, 0]} material={ink}>
        <boxGeometry args={[9.8, 1, 6.8]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 5.4, 4.5, 0]} material={ink}>
          <boxGeometry args={[1.8, 9, 4.5]} />
        </mesh>
      ))}
      <mesh position={[3, 17, 0]} material={ink}>
        <cylinderGeometry args={[0.08, 0.14, 4, 6]} />
      </mesh>
      <mesh position={[0, 9.6, 3.02]}>
        <planeGeometry args={[5.6, 3.5]} />
        <meshBasicMaterial ref={screen} map={face} toneMapped={false} fog={false} />
      </mesh>
      {[-2.4, -0.8, 0.8, 2.4].map((x, i) => (
        <mesh key={x} position={[x, 4.6, 3.02]}>
          <circleGeometry args={[0.2, 12]} />
          <meshBasicMaterial color={i % 2 ? '#ffb020' : '#ff3b30'} toneMapped={false} fog={false} />
        </mesh>
      ))}
      <mesh position={[3, 19.1, 0]}>
        <sphereGeometry args={[0.3, 12, 8]} />
        <meshBasicMaterial ref={beacon} color="#ff2a1a" transparent toneMapped={false} fog={false} />
      </mesh>
    </group>
  );
}

/** Menu backdrop: the Devin fleet underway at night, the Monolith waiting on the horizon. */
export function HeroFleet() {
  return (
    <group>
      {heroShips.map((s) => (
        <HeroShip key={s.spec.id} ship={s} />
      ))}
      <MonolithSilhouette />
    </group>
  );
}
