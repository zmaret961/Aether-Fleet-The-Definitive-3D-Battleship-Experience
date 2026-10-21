import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { fx } from '../state/fx';
import { BoardScene } from './BoardScene';
import { EffectsLayer } from './Effects';
import { Ocean, SKY_HORIZON, SkyDome } from './Ocean';
import { PALETTE } from './config';
import { isSoftwareRenderer, useQuality, useQualityProfile } from './quality';
import { PerfProbe, ShaderWarmup } from './Warmup';
import { SCENE_READY_EVENT } from '../pwa/splash';
import { fitCamera, RESPONSIVE_ASPECT } from './responsiveCamera';

const PostFX = lazy(() => import('./PostFX'));

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

type HeroShot = { radius: number; height: number; base: number; swing: number; look: THREE.Vector3; fov: number };

/** Cinematic menu shots around the hero fleet; each menu step drifts to its own angle. */
const HERO: Record<'menu' | 'howto' | 'commander' | 'difficulty', HeroShot> = {
  menu: { radius: 15.5, height: 3.1, base: 0.32, swing: 0.34, look: v(-0.6, 1.5, -3.5), fov: 40 },
  howto: { radius: 17, height: 4.2, base: 0.1, swing: 0.25, look: v(0, 1.2, -4), fov: 40 },
  commander: { radius: 11.5, height: 2.2, base: 0.72, swing: 0.22, look: v(0.6, 1.1, -2), fov: 38 },
  difficulty: { radius: 14, height: 2.6, base: -0.18, swing: 0.16, look: v(-13.7, 3.2, -2.8), fov: 38 },
};

function CameraRig() {
  const { camera, pointer, size, scene } = useThree();
  const phase = useGame((s) => s.phase);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const t = useRef(0);
  const phaseT = useRef(0);
  const lastPhase = useRef(phase);
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const shake = useRef(0);
  const tmp = useRef(new THREE.Vector3());
  const fogBase = useRef<[number, number] | null>(null);

  useEffect(
    () =>
      fx.subscribe((event) => {
        if (event.type === 'bossMood') return;
        if (reducedMotion) return;
        if (event.type === 'explosion') shake.current = Math.max(shake.current, 0.22);
        else if (event.type === 'sink') shake.current = Math.max(shake.current, 0.4);
      }),
    [reducedMotion],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    t.current += dt;
    if (lastPhase.current !== phase) {
      lastPhase.current = phase;
      phaseT.current = 0;
    }
    phaseT.current += dt;
    const battleLike = phase === 'battle' || phase === 'over';
    const cam = camera as THREE.PerspectiveCamera;
    const motion = reducedMotion ? 0 : 1;
    const fog = scene.fog as THREE.Fog | null;
    if (fog) fogBase.current ??= [fog.near, fog.far];

    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    let fov: number;
    let fogScale = 1;
    if (phase === 'menu' || phase === 'commander' || phase === 'difficulty' || phase === 'howto') {
      const shot = HERO[phase];
      const portrait = size.width / size.height < RESPONSIVE_ASPECT;
      const a = shot.base + Math.sin(t.current * 0.045) * shot.swing * motion;
      const r = shot.radius * (portrait ? 1.45 : 1);
      pos = v(Math.sin(a) * r, shot.height * (portrait ? 1.3 : 1) + Math.sin(t.current * 0.21) * 0.25 * motion, Math.cos(a) * r);
      target = shot.look.clone();
      fov = shot.fov + (portrait ? 14 : 0);
    } else {
      const fit = fitCamera(phase === 'deploy' ? 'deploy' : 'battle', size.width, size.height);
      pos = fit.position.clone();
      target = fit.look.clone();
      fov = fit.fov;
      fogScale = fit.scale;
      pos.x += Math.sin(t.current * 0.23) * 0.16 * motion;
      pos.y += Math.sin(t.current * 0.31 + 1.3) * 0.1 * motion;
      if (phase === 'over') {
        // slow victory/defeat push-in toward the enemy waters and the boss
        const k = Math.min(phaseT.current / 7, 1) * 0.35 * (motion || 0.2);
        pos.lerp(target.clone().add(v(0, 0.6, -2)), k * 0.35);
      }
    }
    if (fog && fogBase.current) {
      fog.near = fogBase.current[0] * fogScale;
      fog.far = fogBase.current[1] * fogScale;
    }
    pos.x += pointer.x * (battleLike ? 0.22 : 0.6) * motion;
    pos.y += pointer.y * (battleLike ? 0.12 : 0.3) * motion;

    const ease = 1 - Math.exp(-dt * (phaseT.current < 2.5 ? 1.6 : 3));
    camera.position.lerp(pos, ease);
    look.current.lerp(target, ease);

    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * ease;
      cam.updateProjectionMatrix();
    }

    camera.lookAt(look.current);
    if (shake.current > 0.001) {
      const s = shake.current;
      tmp.current.set(Math.sin(t.current * 61) * s, Math.sin(t.current * 47 + 2) * s * 0.6, 0);
      camera.position.add(tmp.current.multiplyScalar(0.25));
      shake.current *= Math.exp(-dt * 6);
    }
  });
  return null;
}

function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  const { maxDpr, minDpr } = useQualityProfile();
  return (
    <PerformanceMonitor
      flipflops={4}
      onChange={({ factor }) => {
        setDpr(Math.min(maxDpr, Math.max(minDpr, maxDpr * (0.55 + factor * 0.65))));
      }}
      onFallback={() => {
        if (!isSoftwareRenderer(gl.getContext())) useQuality.getState().degrade();
      }}
    />
  );
}

function StudioEnvironment() {
  return (
    <Environment resolution={128} frames={1}>
      <color attach="background" args={['#06121f']} />
      <Lightformer form="rect" intensity={2.2} color="#cfe6ff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 6, 1]} />
      <Lightformer form="rect" intensity={1.4} color={PALETTE.accentSoft} position={[-10, 2, -4]} rotation-y={Math.PI / 2} scale={[12, 2, 1]} />
      <Lightformer form="rect" intensity={0.9} color="#ffd6a8" position={[10, 3, 6]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
      <Lightformer form="ring" intensity={0.8} color={PALETTE.enemy} position={[0, 4, -12]} scale={4} />
    </Environment>
  );
}

function KeyLight({ mapSize }: { mapSize: number }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const shadow = ref.current?.shadow;
    if (!shadow || !mapSize || shadow.mapSize.x === mapSize) return;
    shadow.mapSize.set(mapSize, mapSize);
    shadow.map?.dispose();
    shadow.map = null;
  }, [mapSize]);
  useEffect(() => {
    const light = ref.current;
    if (!light) return;
    const camera = light.shadow.camera;
    camera.left = -13;
    camera.right = 13;
    camera.top = 13;
    camera.bottom = -13;
    camera.near = 1;
    camera.far = 50;
    camera.updateProjectionMatrix();
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.02;
  }, []);
  return (
    <directionalLight
      ref={ref}
      position={[-9, 16, 8]}
      intensity={2.1}
      color="#e4f0ff"
      castShadow={mapSize > 0}
      shadow-mapSize={[mapSize || 1024, mapSize || 1024]}
    />
  );
}

function BossGlow() {
  const phase = useGame((s) => s.phase);
  const ref = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const on = phase === 'battle' || phase === 'over' ? 14 : 0;
    ref.current.intensity += (on - ref.current.intensity) * Math.min(dt * 2, 1);
  });
  return <pointLight ref={ref} position={[0, 5, -12]} intensity={0} color={PALETTE.enemy} distance={18} decay={1.6} />;
}

function SceneContent({ warm, onWarm }: { warm: boolean; onWarm: (ms: number) => void }) {
  const q = useQualityProfile();
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  return (
    <>
      <color attach="background" args={[PALETTE.deepSea]} />
      <fog attach="fog" args={[SKY_HORIZON, 34, 95]} />
      <SkyDome />
      {q.envMap && <StudioEnvironment />}
      <ambientLight intensity={0.25} color="#9ecbff" />
      <hemisphereLight args={['#bcdcff', '#06101c', 0.85]} />
      <KeyLight mapSize={q.shadowMapSize} />
      <directionalLight position={[8, 6, -14]} intensity={1.1} color={PALETTE.accentSoft} />
      <BossGlow />
      <Ocean amp={reducedMotion ? 0.08 : 0.2} caustics={q.caustics} segments={q.oceanSegments} />
      <BoardScene />
      <EffectsLayer />
      <CameraRig />
      {!warm && <ShaderWarmup onReady={onWarm} postfx={q.postfx} />}
      <PerfProbe />
      {q.postfx && (
        <Suspense fallback={null}>
          <PostFX />
        </Suspense>
      )}
    </>
  );
}

export function Scene() {
  const q = useQualityProfile();
  // Hold the render loop while the splash is up so shaders compile in parallel
  // (KHR_parallel_shader_compile) instead of stalling the first frames.
  const [warm, setWarm] = useState(false);
  const onWarm = useCallback((ms: number) => {
    performance.mark?.('aether:shaders-warm', { detail: { ms } });
    setWarm(true);
    requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event(SCENE_READY_EVENT))));
  }, []);
  return (
    <div className="fixed inset-0 touch-none">
      <Canvas
        frameloop={warm ? 'always' : 'never'}
        dpr={[q.minDpr, q.maxDpr]}
        shadows={q.shadowMapSize ? { type: THREE.PCFSoftShadowMap } : false}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [0, 12.6, 10.2], fov: 46, near: 0.1, far: 400 }}
      >
        <AdaptiveDpr />
        <Suspense fallback={null}>
          <SceneContent warm={warm} onWarm={onWarm} />
        </Suspense>
      </Canvas>
    </div>
  );
}
