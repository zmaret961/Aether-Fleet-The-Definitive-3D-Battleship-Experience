import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, Bloom, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { fx } from '../state/fx';
import { BoardScene } from './BoardScene';
import { EffectsLayer } from './Effects';
import { Ocean, SKY_HORIZON, SkyDome } from './Ocean';
import { PALETTE } from './config';

type Shot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Cinematic framings per phase. Battle frames both boards plus the Monolith.
const SHOTS = {
  deploy: { pos: v(0, 12.6, 10.2), look: v(0, 0, 0.6), fov: 46 },
  battle: { pos: v(0, 19, 23.5), look: v(0, 0.9, -0.9), fov: 48 },
} satisfies Record<string, Shot>;

function CameraRig() {
  const { camera, pointer } = useThree();
  const phase = useGame((s) => s.phase);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const t = useRef(0);
  const phaseT = useRef(0);
  const lastPhase = useRef(phase);
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const shake = useRef(0);
  const tmp = useRef(new THREE.Vector3());

  useEffect(
    () =>
      fx.subscribe((e) => {
        if (reducedMotion) return;
        if (e.type === 'explosion') shake.current = Math.max(shake.current, 0.22);
        else if (e.type === 'sink') shake.current = Math.max(shake.current, 0.4);
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
    const menuLike = phase === 'menu' || phase === 'commander' || phase === 'difficulty' || phase === 'howto';
    const battleLike = phase === 'battle' || phase === 'over';
    const cam = camera as THREE.PerspectiveCamera;
    const motion = reducedMotion ? 0 : 1;

    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    let fov: number;
    if (menuLike) {
      // slow orbit low over the water, like a fleet reveal
      const a = t.current * 0.06 * motion + 0.4;
      pos = v(Math.sin(a) * 13, 6.2 + Math.sin(t.current * 0.2) * 0.4 * motion, Math.cos(a) * 13);
      target = v(0, 0.4, 0);
      fov = 44;
    } else {
      const shot = battleLike ? SHOTS.battle : SHOTS.deploy;
      pos = shot.pos.clone();
      target = shot.look.clone();
      fov = shot.fov;
      // handheld breathing so the frame never feels static
      pos.x += Math.sin(t.current * 0.23) * 0.22 * motion;
      pos.y += Math.sin(t.current * 0.31 + 1.3) * 0.12 * motion;
      // result screen: slow push-in toward the enemy waters
      if (phase === 'over') {
        const k = Math.min(phaseT.current / 6, 1);
        pos.lerp(v(0, 13.5, 17.5), k * 0.6);
      }
    }
    pos.x += pointer.x * (battleLike ? 0.3 : 0.6) * motion;
    pos.y += pointer.y * (battleLike ? 0.18 : 0.35) * motion;

    // ease: slower glide right after a phase change for a dolly feel
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

/** Procedural studio env (no network): gives hulls real reflections. */
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

function KeyLight({ shadows }: { shadows: boolean }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const c = l.shadow.camera;
    c.left = -13;
    c.right = 13;
    c.top = 13;
    c.bottom = -13;
    c.near = 1;
    c.far = 50;
    c.updateProjectionMatrix();
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
  }, []);
  return (
    <directionalLight
      ref={ref}
      position={[-9, 16, 8]}
      intensity={2.1}
      color="#e4f0ff"
      castShadow={shadows}
      shadow-mapSize={[2048, 2048]}
    />
  );
}

/** Hostile rose underglow from the Monolith — only once the boss is on stage. */
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

function SceneContent() {
  const perfMode = useGame((s) => s.settings.perfMode);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const low = perfMode === 'low';
  return (
    <>
      <color attach="background" args={[PALETTE.deepSea]} />
      <fog attach="fog" args={[SKY_HORIZON, 34, 95]} />
      <SkyDome />
      {!low && <StudioEnvironment />}
      <ambientLight intensity={0.25} color="#9ecbff" />
      <hemisphereLight args={['#bcdcff', '#06101c', 0.85]} />
      <KeyLight shadows={!low} />
      {/* cyan rim from behind the enemy waters */}
      <directionalLight position={[8, 6, -14]} intensity={1.1} color={PALETTE.accentSoft} />
      <BossGlow />
      <Ocean amp={reducedMotion ? 0.08 : 0.2} caustics={low ? 0.4 : 1} segments={low ? 64 : 128} />
      <BoardScene />
      <EffectsLayer />
      <CameraRig />
      {!low && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom intensity={0.7} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur radius={0.7} />
          <Vignette offset={0.28} darkness={0.62} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

export function Scene() {
  const low = useGame((s) => s.settings.perfMode) === 'low';
  return (
    <div className="fixed inset-0 touch-none">
      <Canvas
        dpr={[0.8, 2]}
        shadows={low ? false : { type: THREE.PCFSoftShadowMap }}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [0, 12.6, 10.2], fov: 46, near: 0.1, far: 400 }}
      >
        <AdaptiveDpr />
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
