import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedShip } from '../game/types';
import { cellToWorld, PALETTE } from './config';

/**
 * Stylized warship built from primitives: hull, raked bow, deck, bridge,
 * funnel and gun barrels sized by ship class. Sunk ships list and submerge.
 */
export function ShipMesh({ ship, ghost = false, valid = true }: { ship: PlacedShip; ghost?: boolean; valid?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const sinkT = useRef(0);

  const { center, angle, len } = useMemo(() => {
    const first = ship.cells[0];
    const last = ship.cells[ship.cells.length - 1];
    const horizontal = last.x !== first.x;
    const xs = ship.cells.map((c) => cellToWorld(c)[0]);
    const zs = ship.cells.map((c) => cellToWorld(c)[1]);
    return {
      center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] as const,
      angle: horizontal ? 0 : Math.PI / 2,
      len: ship.spec.length,
    };
  }, [ship]);

  useFrame((_, dt) => {
    if (!group.current) return;
    if (ship.sunk) {
      sinkT.current = Math.min(sinkT.current + dt, 8);
      const t = sinkT.current;
      group.current.position.y = -Math.min(t * 0.55, 2.6);
      group.current.rotation.z = angle === 0 ? Math.min(t * 0.16, 0.7) : Math.min(t * 0.16, 0.7);
      group.current.rotation.x = angle === 0 ? Math.min(t * 0.1, 0.4) : -Math.min(t * 0.1, 0.4);
    } else {
      // gentle bobbing on the swell
      const t = performance.now() / 1000;
      group.current.position.y = Math.sin(t * 0.9 + center[0] * 0.7 + center[1] * 0.5) * 0.045;
      group.current.rotation.z = Math.sin(t * 0.7 + center[1]) * 0.015;
    }
  });

  const hullMat = ghost
    ? new THREE.MeshStandardMaterial({
        color: valid ? PALETTE.accent : PALETTE.enemy,
        transparent: true,
        opacity: 0.45,
        emissive: valid ? PALETTE.accentSoft : PALETTE.enemy,
        emissiveIntensity: 0.6,
      })
    : new THREE.MeshStandardMaterial({
        color: PALETTE.hull,
        metalness: 0.35,
        roughness: 0.55,
        emissive: '#0d1a26',
        emissiveIntensity: 0.35,
        transparent: ship.sunk,
      });
  const deckMat = new THREE.MeshStandardMaterial({
    color: ghost ? (valid ? PALETTE.accentSoft : PALETTE.enemy) : PALETTE.hullDark,
    metalness: 0.3,
    roughness: 0.6,
    emissive: '#0a141d',
    emissiveIntensity: 0.3,
    transparent: ghost || ship.sunk,
    opacity: ghost ? 0.5 : 1,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: PALETTE.accent,
    emissive: PALETTE.accentSoft,
    emissiveIntensity: ghost ? 1.2 : 0.5,
    transparent: true,
    opacity: ghost ? 0.7 : 0.9,
  });

  const L = len * 0.8;
  const W = 0.58;
  const isCarrier = ship.spec.id === 'carrier';
  const isDestroyer = ship.spec.id === 'destroyer';

  return (
    <group ref={group} position={[center[0], 0.02, center[1]]} rotation={[0, angle, 0]}>
      {/* hull */}
      <mesh position={[0, 0.12, 0]} material={hullMat}>
        <boxGeometry args={[L * 0.82, 0.3, W]} />
      </mesh>
      {/* raked bow */}
      <mesh position={[L * 0.46, 0.12, 0]} rotation={[0, 0, -Math.PI / 2]} material={hullMat}>
        <coneGeometry args={[W / 2, L * 0.32, 4]} />
      </mesh>
      {/* deck */}
      <mesh position={[-L * 0.05, 0.32, 0]} material={deckMat}>
        <boxGeometry args={[L * 0.72, 0.14, W * 0.78]} />
      </mesh>
      {/* island / bridge */}
      {!isCarrier && (
        <mesh position={[-L * 0.14, 0.5, isCarrier ? W * 0.3 : 0]} material={deckMat}>
          <boxGeometry args={[L * 0.16, 0.3, W * 0.4]} />
        </mesh>
      )}
      {isCarrier && (
        <mesh position={[L * 0.06, 0.5, W * 0.32]} material={deckMat}>
          <boxGeometry args={[L * 0.14, 0.34, W * 0.3]} />
        </mesh>
      )}
      {/* mast */}
      {!isDestroyer && (
        <mesh position={[-L * 0.14, 0.78, 0]} material={accentMat}>
          <cylinderGeometry args={[0.015, 0.03, 0.36, 6]} />
        </mesh>
      )}
      {/* gun barrels on capital ships */}
      {len >= 4 && (
        <>
          <mesh position={[L * 0.3, 0.42, 0]} rotation={[0, 0, Math.PI / 2]} material={deckMat}>
            <cylinderGeometry args={[0.035, 0.035, 0.42, 8]} />
          </mesh>
          <mesh position={[L * 0.3, 0.36, 0]} material={deckMat}>
            <boxGeometry args={[0.22, 0.12, 0.22]} />
          </mesh>
        </>
      )}
      {/* waterline glow strip */}
      <mesh position={[0, 0.05, 0]} material={accentMat}>
        <boxGeometry args={[L * 0.84, 0.02, W + 0.02]} />
      </mesh>
    </group>
  );
}
