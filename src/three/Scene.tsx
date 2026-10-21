import { lazy, Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { BoardScene } from './BoardScene';
import { EffectsLayer } from './Effects';
import { Ocean } from './Ocean';
import { PALETTE } from './config';
import { DEVICE, isSoftwareRenderer, useQuality } from './quality';
import { fitCamera } from './responsiveCamera';

const PostFX = lazy(() => import('./PostFX'));

function CameraRig() {
  const { camera, pointer, size, scene } = useThree();
  const phase = useGame((s) => s.phase);
  const t = useRef(0);
  const fogBase = useRef<[number, number] | null>(null);
  useFrame((_, dt) => {
    t.current += dt;
    const menuLike = phase === 'menu' || phase === 'commander' || phase === 'difficulty' || phase === 'howto';
    const battleLike = phase === 'battle' || phase === 'over';
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    let fov = battleLike ? 39 : 48;
    let base = menuLike
      ? new THREE.Vector3(Math.sin(t.current * 0.08) * 4, 13.5, 12 + Math.cos(t.current * 0.08) * 2)
      : phase === 'deploy'
        ? new THREE.Vector3(0, 13.2, 11.4)
      : new THREE.Vector3(0, 9, 28);
    let look = new THREE.Vector3(0, battleLike ? 1.2 : 0, phase === 'deploy' || menuLike ? 0 : -0.8);
    // Portrait phones/tablets: re-frame so both boards fit (no-op on desktop).
    const fit = menuLike ? null : fitCamera(phase === 'deploy' ? 'deploy' : 'battle', base, look, fov, size.width / size.height);
    if (fit) ({ position: base, look, fov } = { position: fit.position.clone(), look: fit.look, fov: fit.fov });
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fogBase.current ??= [fog.near, fog.far];
      const k = fit?.scale ?? 1;
      fog.near = fogBase.current[0] * k;
      fog.far = fogBase.current[1] * k;
    }
    if (perspectiveCamera.fov !== fov) {
      perspectiveCamera.fov = fov;
      perspectiveCamera.updateProjectionMatrix();
    }
    base.x += pointer.x * (battleLike ? 0.25 : 0.7);
    base.y += pointer.y * (battleLike ? 0.15 : 0.4);
    camera.position.lerp(base, 0.045);
    camera.lookAt(look);
  });
  return null;
}

/** Scales render resolution to hold ~60fps (drei's PerformanceMonitor). */
function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  const setBloom = useQuality((s) => s.setBloom);
  return (
    <PerformanceMonitor
      flipflops={4}
      onChange={({ factor }) => {
        setDpr(Math.min(DEVICE.maxDpr, Math.max(0.7, DEVICE.maxDpr * (0.55 + factor * 0.65))));
      }}
      // Still under budget at minimum resolution: shed bloom (Auto mode only).
      onFallback={() => {
        if (useGame.getState().settings.perfMode === 'auto' && !isSoftwareRenderer(gl.getContext())) setBloom(false);
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
      <EffectsLayer />
      <CameraRig />
      {!low && (
        <Suspense fallback={null}>
          <PostFX />
        </Suspense>
      )}
    </>
  );
}

export function Scene() {
  return (
    <div className="fixed inset-0 touch-none">
      <Canvas
        dpr={[0.8, DEVICE.maxDpr]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
        camera={{ position: [0, 13.2, 11.4], fov: 48, near: 0.1, far: 120 }}
      >
        <AdaptiveDpr />
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
