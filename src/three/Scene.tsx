import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { BoardScene } from './BoardScene';
import { Ocean } from './Ocean';
import { PALETTE } from './config';

function CameraRig() {
  const { camera, pointer } = useThree();
  const phase = useGame((s) => s.phase);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    const menuLike = phase === 'menu' || phase === 'difficulty' || phase === 'howto';
    const base = menuLike
      ? new THREE.Vector3(Math.sin(t.current * 0.08) * 4, 13.5, 12 + Math.cos(t.current * 0.08) * 2)
      : phase === 'deploy'
        ? new THREE.Vector3(0, 13.2, 11.4)
        : new THREE.Vector3(0, 17.5, 16.5);
    base.x += pointer.x * 0.7;
    base.y += pointer.y * 0.4;
    camera.position.lerp(base, 0.045);
    camera.lookAt(0, 0, phase === 'deploy' || menuLike ? 0 : -1.5);
  });
  return null;
}

/** Scales render resolution to hold ~60fps (drei's PerformanceMonitor). */
function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr);
  return (
    <PerformanceMonitor
      onChange={({ factor }) => {
        const base = Math.min(window.devicePixelRatio, 2);
        setDpr(Math.min(2, Math.max(0.7, base * (0.55 + factor * 0.65))));
      }}
    />
  );
}

function SceneContent() {
  const perfMode = useGame((s) => s.settings.perfMode);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const low = perfMode === 'low';
  return (
    <>
      <color attach="background" args={[PALETTE.deepSea]} />
      <fog attach="fog" args={[PALETTE.deepSea, 22, 60]} />
      <ambientLight intensity={0.7} color="#9ecbff" />
      <hemisphereLight args={['#b8d8f0', '#081a2c', 0.5]} />
      <directionalLight position={[-6, 12, 6]} intensity={1.35} color="#cfe8ff" />
      <pointLight position={[6, 4, -4]} intensity={6} color={PALETTE.accentSoft} distance={20} />
      <directionalLight position={[8, 5, -9]} intensity={0.55} color={PALETTE.accentSoft} />
      <Ocean amp={reducedMotion ? 0.08 : 0.16} caustics={low ? 0.4 : 0.9} segments={low ? 48 : 96} />
      <BoardScene />
      <CameraRig />
      {!low && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.55} luminanceThreshold={0.32} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

export function Scene() {
  return (
    <div className="fixed inset-0 touch-none">
      <Canvas
        dpr={[0.8, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
        camera={{ position: [0, 13.2, 11.4], fov: 42, near: 0.1, far: 120 }}
      >
        <AdaptiveDpr />
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
