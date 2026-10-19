import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { PALETTE } from './config';

/**
 * The opposing admiral — a stylized cartoon boss looming behind the enemy
 * board. Bobs and sways; squashes when the player lands a hit, swells with
 * menace when the AI lands one.
 */
export function EnemyAdmiral({ position }: { position: [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const pupils = useRef<THREE.Group>(null);
  const lastOutcome = useGame((s) => s.lastOutcome);
  const phase = useGame((s) => s.phase);
  const reactT = useRef(0);
  const lastSeq = useRef(0);

  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#1d2b3d', metalness: 0.3, roughness: 0.6, emissive: '#0b1520', emissiveIntensity: 0.5 }),
    [],
  );
  const capMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0e1826', metalness: 0.35, roughness: 0.5 }),
    [],
  );
  const eyeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#f8fafc', emissive: '#e2e8f0', emissiveIntensity: 0.4 }),
    [],
  );
  const pupilMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PALETTE.hit, emissive: PALETTE.hitHot, emissiveIntensity: 1.6 }),
    [],
  );
  const browMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#060d16', roughness: 0.8 }),
    [],
  );

  useFrame((_, dt) => {
    if (!group.current) return;
    const t = performance.now() / 1000;
    // incoming outcome triggers a reaction
    if (lastOutcome && lastOutcome.seq !== lastSeq.current) {
      lastSeq.current = lastOutcome.seq;
      reactT.current = 0.001;
    }
    if (reactT.current > 0) {
      reactT.current += dt;
      const p = Math.min(reactT.current / 0.9, 1);
      const hitByPlayer = lastOutcome?.by === 'player' && lastOutcome.text !== 'Miss';
      // player hit → squash flinch; ai hit → menacing swell; miss → shrug
      const k = hitByPlayer ? -0.25 : lastOutcome?.by === 'ai' && lastOutcome.text !== 'Enemy missed' ? 0.18 : 0.0;
      const squash = Math.sin(p * Math.PI) * k;
      group.current.scale.set(1 - squash * 0.6, 1 + squash, 1 - squash * 0.6);
      if (p >= 1) reactT.current = 0;
    } else {
      group.current.scale.setScalar(1);
    }
    // idle bob + menace sway
    group.current.position.y = Math.sin(t * 1.1) * 0.35 + 0.4;
    group.current.rotation.y = Math.sin(t * 0.5) * 0.12;
    group.current.rotation.z = Math.sin(t * 0.8) * 0.04;
    // pupils drift to track the action
    if (pupils.current) {
      pupils.current.position.x = Math.sin(t * 0.6) * 0.22;
      pupils.current.position.y = Math.sin(t * 0.9) * 0.1;
    }
  });

  const visible = phase === 'battle' || phase === 'over';

  return (
    <group ref={group} position={position} visible={visible}>
      {/* body — big rounded mass */}
      <mesh position={[0, 1.9, 0]} material={bodyMat}>
        <sphereGeometry args={[2.6, 24, 18]} />
      </mesh>
      {/* shoulders */}
      <mesh position={[-2.5, 1.4, 0.3]} material={bodyMat}>
        <sphereGeometry args={[1.1, 16, 12]} />
      </mesh>
      <mesh position={[2.5, 1.4, 0.3]} material={bodyMat}>
        <sphereGeometry args={[1.1, 16, 12]} />
      </mesh>
      {/* admiral cap */}
      <mesh position={[0, 4.15, 0.3]} material={capMat}>
        <cylinderGeometry args={[1.7, 2.0, 0.9, 20]} />
      </mesh>
      <mesh position={[0, 4.75, 0.3]} material={capMat}>
        <cylinderGeometry args={[1.05, 1.7, 0.55, 20]} />
      </mesh>
      {/* cap brim */}
      <mesh position={[0, 3.72, 1.15]} rotation={[0.35, 0, 0]} material={capMat}>
        <boxGeometry args={[2.2, 0.18, 1.1]} />
      </mesh>
      {/* gold anchor on the cap */}
      <mesh position={[0, 4.2, 1.5]} material={pupilMat}>
        <sphereGeometry args={[0.28, 10, 10]} />
      </mesh>
      {/* eyes */}
      <group ref={pupils} position={[0, 2.6, 1.6]}>
        <mesh position={[-0.95, 0, 0]} material={eyeMat}>
          <sphereGeometry args={[0.62, 16, 12]} />
        </mesh>
        <mesh position={[0.95, 0, 0]} material={eyeMat}>
          <sphereGeometry args={[0.62, 16, 12]} />
        </mesh>
        <mesh position={[-0.95, 0, 0.42]} material={pupilMat}>
          <sphereGeometry args={[0.3, 12, 10]} />
        </mesh>
        <mesh position={[0.95, 0, 0.42]} material={pupilMat}>
          <sphereGeometry args={[0.3, 12, 10]} />
        </mesh>
      </group>
      {/* angry brows */}
      <mesh position={[-0.95, 3.45, 1.85]} rotation={[0, 0, -0.45]} material={browMat}>
        <boxGeometry args={[1.15, 0.28, 0.35]} />
      </mesh>
      <mesh position={[0.95, 3.45, 1.85]} rotation={[0, 0, 0.45]} material={browMat}>
        <boxGeometry args={[1.15, 0.28, 0.35]} />
      </mesh>
      {/* jagged grin */}
      <mesh position={[0, 1.15, 2.15]} material={browMat}>
        <boxGeometry args={[1.7, 0.4, 0.35]} />
      </mesh>
      <mesh position={[-0.55, 1.38, 2.2]} rotation={[0, 0, 0.5]} material={browMat}>
        <boxGeometry args={[0.5, 0.3, 0.3]} />
      </mesh>
      <mesh position={[0.55, 1.38, 2.2]} rotation={[0, 0, -0.5]} material={browMat}>
        <boxGeometry args={[0.5, 0.3, 0.3]} />
      </mesh>
      {/* under-glow — menacing rim light */}
      <pointLight position={[0, 0.5, 2.8]} intensity={8} color={PALETTE.enemy} distance={9} />
    </group>
  );
}
