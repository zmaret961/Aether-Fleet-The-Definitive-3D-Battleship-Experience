import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../state/store';

function makeFaceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);

  context.imageSmoothingEnabled = false;
  context.fillStyle = '#06150d';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#0b2718';
  context.fillRect(5, 5, 246, 118);

  context.fillStyle = '#75ff94';
  context.shadowColor = '#55ff7b';
  context.shadowBlur = 14;
  context.fillRect(35, 30, 48, 8);
  context.fillRect(43, 38, 40, 8);
  context.fillRect(51, 46, 32, 8);
  context.fillRect(173, 30, 48, 8);
  context.fillRect(173, 38, 40, 8);
  context.fillRect(173, 46, 32, 8);
  context.fillRect(91, 88, 74, 7);
  context.fillRect(83, 95, 24, 7);
  context.fillRect(149, 95, 24, 7);
  context.fillRect(107, 102, 42, 7);
  context.shadowBlur = 0;

  context.fillStyle = '#d8ffe0';
  context.fillRect(59, 39, 12, 10);
  context.fillRect(185, 39, 12, 10);
  context.fillRect(91, 88, 74, 3);

  context.fillStyle = 'rgba(138, 255, 170, 0.16)';
  for (let y = 8; y < 120; y += 6) context.fillRect(6, y, 244, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeStatusTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#2b3333';
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = '#d8c49c';
    context.font = 'bold 20px monospace';
    context.fillText('COBOL · BATCH 01', 12, 27);
    context.fillStyle = '#a9ff73';
    context.font = '14px monospace';
    context.fillText('NO PATCHES SINCE 1987', 12, 49);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function CableTentacle({ side, phase }: { side: -1 | 1; phase: number }) {
  const cable = useRef<THREE.Group>(null);
  const curve = useMemo(() => {
    const points = [
      new THREE.Vector3(side * 1.75, 1.1, -0.25),
      new THREE.Vector3(side * 2.35, 0.55, 0.15),
      new THREE.Vector3(side * 2.9, 0.25, 0.65),
      new THREE.Vector3(side * 3.1, 0.62, 1.15),
      new THREE.Vector3(side * 2.8, 0.82, 1.48),
    ];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.11, 8, false);
  }, [side]);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#263c47', metalness: 0.72, roughness: 0.32 }),
    [],
  );

  useFrame((_, _dt) => {
    if (!cable.current) return;
    const t = performance.now() / 1000;
    cable.current.rotation.y = Math.sin(t * 1.15 + phase) * 0.09;
    cable.current.rotation.z = Math.sin(t * 0.8 + phase) * 0.045 * side;
  });

  useEffect(
    () => () => {
      curve.dispose();
      material.dispose();
    },
    [curve, material],
  );

  return (
    <group ref={cable}>
      <mesh geometry={curve} material={material} />
      <mesh position={[side * 2.8, 0.82, 1.48]}>
        <sphereGeometry args={[0.18, 12, 8]} />
        <meshStandardMaterial color="#98a69a" metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  );
}

export function LegacyMonolith({ position }: { position: [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const indicators = useRef<(THREE.Mesh | null)[]>([]);
  const lastOutcome = useGame((s) => s.lastOutcome);
  const phase = useGame((s) => s.phase);
  const reactT = useRef(0);
  const lastSeq = useRef(0);
  const faceTexture = useMemo(makeFaceTexture, []);
  const statusTexture = useMemo(makeStatusTexture, []);
  const cabinet = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#a59e8d', metalness: 0.38, roughness: 0.48 }),
    [],
  );
  const trim = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#5a6461', metalness: 0.72, roughness: 0.3 }),
    [],
  );
  const screenFrame = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#202d2a', metalness: 0.66, roughness: 0.25 }),
    [],
  );

  useEffect(
    () => () => {
      faceTexture.dispose();
      statusTexture.dispose();
      cabinet.dispose();
      trim.dispose();
      screenFrame.dispose();
    },
    [cabinet, faceTexture, screenFrame, statusTexture, trim],
  );

  useFrame((_, dt) => {
    if (!group.current) return;
    const t = performance.now() / 1000;
    if (lastOutcome && lastOutcome.seq !== lastSeq.current) {
      lastSeq.current = lastOutcome.seq;
      reactT.current = 0.001;
    }
    if (reactT.current > 0) {
      reactT.current += dt;
      const p = Math.min(reactT.current / 0.9, 1);
      const hitByPlayer = lastOutcome?.by === 'player' && lastOutcome.text !== 'CI failed';
      const hitByAi = lastOutcome?.by === 'ai' && lastOutcome.text !== "Legacy's build failed";
      const squash = Math.sin(p * Math.PI) * (hitByPlayer ? -0.13 : hitByAi ? 0.12 : 0);
      group.current.scale.set(1 - squash * 0.55, 1 + squash, 1 - squash * 0.55);
      if (p >= 1) reactT.current = 0;
    } else {
      group.current.scale.setScalar(1);
    }

    group.current.position.y = Math.sin(t * 1.1) * 0.12;
    group.current.rotation.y = Math.sin(t * 0.45) * 0.05;
    group.current.rotation.z = Math.sin(t * 0.75) * 0.018;
    indicators.current.forEach((light, index) => {
      const material = light?.material as THREE.MeshStandardMaterial | undefined;
      if (material) material.emissiveIntensity = 0.6 + (0.4 + 0.4 * Math.sin(t * 2.4 + index)) * 1.8;
    });
  });

  const visible = phase === 'battle' || phase === 'over';

  return (
    <group ref={group} position={position} visible={visible}>
      <pointLight position={[0, 4.7, 3.8]} intensity={12} color="#ffd69a" distance={16} />
      <pointLight position={[0, 4.4, -1.8]} intensity={10} color="#70eaff" distance={13} />

      <mesh position={[0, 2.95, 0]} material={cabinet}>
        <boxGeometry args={[4.8, 5.55, 1.9]} />
      </mesh>
      <mesh position={[0, 0.22, 0.05]} material={trim}>
        <boxGeometry args={[5.1, 0.45, 2.15]} />
      </mesh>
      <mesh position={[0, 5.78, 0.02]} material={trim}>
        <boxGeometry args={[4.95, 0.28, 2.05]} />
      </mesh>
      <mesh position={[0, 4.05, 1.01]} material={screenFrame}>
        <boxGeometry args={[3.82, 2.2, 0.22]} />
      </mesh>
      <mesh position={[0, 4.05, 1.135]}>
        <planeGeometry args={[3.48, 1.84]} />
        <meshBasicMaterial map={faceTexture} toneMapped={false} />
      </mesh>

      <mesh position={[0, 2.45, 1.01]} material={trim}>
        <boxGeometry args={[3.7, 0.78, 0.18]} />
      </mesh>
      <mesh position={[0, 2.45, 1.115]}>
        <planeGeometry args={[3.46, 0.62]} />
        <meshBasicMaterial map={statusTexture} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.22, 1.01]} material={trim}>
        <boxGeometry args={[3.72, 0.1, 0.15]} />
      </mesh>

      {Array.from({ length: 6 }).map((_, row) => (
        <mesh key={`vent-${row}`} position={[-1.66, 1.85 - row * 0.18, 0.99]} material={screenFrame}>
          <boxGeometry args={[0.58, 0.055, 0.08]} />
        </mesh>
      ))}
      {Array.from({ length: 6 }).map((_, row) => (
        <mesh key={`vent-right-${row}`} position={[1.66, 1.85 - row * 0.18, 0.99]} material={screenFrame}>
          <boxGeometry args={[0.58, 0.055, 0.08]} />
        </mesh>
      ))}

      {Array.from({ length: 5 }).map((_, index) => (
        <mesh
          key={`indicator-${index}`}
          ref={(mesh) => { indicators.current[index] = mesh; }}
          position={[-1.52 + index * 0.76, 0.82, 1.02]}
        >
          <sphereGeometry args={[0.085, 10, 8]} />
          <meshStandardMaterial
            color={index % 2 ? '#b9ff64' : '#ffb957'}
            emissive={index % 2 ? '#78ff54' : '#ff8d3c'}
            emissiveIntensity={1.4}
            toneMapped={false}
          />
        </mesh>
      ))}

      <CableTentacle side={-1} phase={0.2} />
      <CableTentacle side={-1} phase={2.3} />
      <CableTentacle side={1} phase={1.1} />
      <CableTentacle side={1} phase={3.4} />
    </group>
  );
}
