import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fx, MISSILE_FLIGHT_MS } from '../state/fx';
import type { BoardSide } from '../state/fx';
import { ENEMY_FLEET_NAMES } from '../game/types';
import { useGame } from '../state/store';
import { scaleCount } from './quality';
import { cellToWorld, LEGACY_MONOLITH_POSITION, LEGACY_MONOLITH_SCALE, PALETTE, PLAYER_BOARD_POS } from './config';
import {
  addTrauma,
  BOSS_POD_LOCAL,
  burstGeometry,
  cellWorld,
  DEBRIS,
  FIREBALL,
  flashLight,
  fxNow,
  fxUniforms,
  LIGHT_POOL_SIZE,
  lightSlots,
  makeParticleGeometry,
  makeParticleMaterial,
  MIST,
  rand,
  realNow,
  shipAt,
  SMOKE,
  slowMo,
  SPARKS,
  takeTrauma,
  tickFx,
  WATER_COLUMN,
  WATER_CROWN,
} from './fxKit';
import type { BurstSpec } from './fxKit';

const FLIGHT = MISSILE_FLIGHT_MS / 1000;

type Kind = 'sonar' | 'missile' | 'splash' | 'explosion' | 'sink';

interface Item {
  id: number;
  kind: Kind;
  birth: number;
  realBirth?: number;
  life: number;
  side: BoardSide;
  ship?: { id: string; name: string };
  pos: THREE.Vector3;
  start?: THREE.Vector3;
  cells?: THREE.Vector3[];
}

let nextId = 1;

// ------------------------------------------------------------------ primitives

/** GPU particle burst — positions are solved in the shader from `birth`. */
export function Burst({
  spec,
  birth,
  position = [0, 0, 0],
}: {
  spec: BurstSpec;
  birth: number;
  position?: [number, number, number];
}) {
  const geometry = useMemo(() => burstGeometry({ ...spec, count: scaleCount(spec.count) }), [spec]);
  const material = useMemo(() => makeParticleMaterial(spec, birth), [spec, birth]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <points geometry={geometry} material={material} position={position} frustumCulled={false} />;
}

/** Flat expanding ring on the water (shockwave, ripple, foam disc). */
export function Ring({
  birth,
  life,
  from,
  to,
  color,
  opacity = 0.8,
  inner = 0.82,
  y = 0.1,
  additive = true,
  position = [0, 0, 0],
}: {
  birth: number;
  life: number;
  from: number;
  to: number;
  color: string;
  opacity?: number;
  inner?: number;
  y?: number;
  additive?: boolean;
  position?: [number, number, number];
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!mesh.current || !mat.current) return;
    const p = (fxNow() - birth) / life;
    mesh.current.visible = p >= 0 && p <= 1;
    if (!mesh.current.visible) return;
    const e = 1 - Math.pow(1 - p, 3);
    mesh.current.scale.setScalar(from + (to - from) * e);
    mat.current.opacity = opacity * (1 - p) * (1 - p);
  });
  return (
    <mesh ref={mesh} position={[position[0], y, position[2]]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[inner, 1, 48]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </mesh>
  );
}

/** Hot core flash: an additive sphere that pops then fades. */
function Glow({
  birth,
  life,
  size,
  color,
  position,
}: {
  birth: number;
  life: number;
  size: number;
  color: string;
  position: [number, number, number];
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!mesh.current || !mat.current) return;
    const p = (fxNow() - birth) / life;
    mesh.current.visible = p >= 0 && p <= 1;
    if (!mesh.current.visible) return;
    mesh.current.scale.setScalar(size * (0.35 + Math.sqrt(p) * 0.9));
    mat.current.opacity = Math.pow(1 - p, 2);
  });
  return (
    <mesh ref={mesh} position={position} visible={false}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial
        ref={mat}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ------------------------------------------------------------------ compositions

const scaled = (spec: BurstSpec, k: number, extra: Partial<BurstSpec> = {}): BurstSpec => ({
  ...spec,
  count: Math.round(spec.count * k),
  ...extra,
});

const MINI_FIREBALL = scaled(FIREBALL, 0.6, { size: [0.55, 0.95] });
const MINI_SPARKS = scaled(SPARKS, 0.45);
const BIG_COLUMN = scaled(WATER_COLUMN, 1.8, { up: [5.5, 9.0], spread: 0.6, life: [1.2, 1.8], size: [0.16, 0.34] });
const BIG_SMOKE = scaled(SMOKE, 1.9, {
  life: [2.8, 4.4],
  up: [1.1, 2.0],
  size: [0.9, 1.5],
  spread: 0.9,
  delay: [0.2, 1.4],
  colors: ['#2b2420', '#1f2227', '#454b54'],
});
const EMBERS: BurstSpec = {
  count: 40, life: [1.2, 2.2], speed: [0.3, 1.0], up: [1.4, 2.6], size: [0.05, 0.09], spread: 0.6, delay: [0, 1.2],
  shape: 'ring', drag: 0.8, colors: ['#fff1c2', '#ff9d3d', '#ff4d1a'], additive: true, soft: 0.6, wind: [0.2, 0, -0.1],
};
const CHURN: BurstSpec = {
  count: 26, life: [1.4, 2.4], speed: [0.1, 0.4], up: [0.1, 0.35], size: [0.18, 0.3], spread: 0.35, delay: [0.2, 2.6],
  shape: 'ring', sizeStart: 0.6, sizeEnd: 1.6, colors: ['#ffffff', '#d6f0ff', '#90c6e6'], opacity: 0.55, soft: 1.4,
};
const MUZZLE_SMOKE = scaled(SMOKE, 0.55, { life: [0.45, 0.8], up: [0.15, 0.45], size: [0.35, 0.6], delay: [0, 0.08], colors: ['#d9dee6', '#a1a9b4', '#5d6670'], opacity: 0.38 });
const MERGE_SPARKS = scaled(SPARKS, 0.8, { colors: ['#ffffff', PALETTE.accent, '#22d3ee'], speed: [3.5, 7] });

function Explosion({ item }: { item: Item }) {
  const { birth, pos, side } = item;
  const y = side === 'player' ? 0.45 : 0.25;
  const p: [number, number, number] = [pos.x, y, pos.z];
  return (
    <group>
      <Glow birth={birth} life={0.32} size={1.15} color="#fff3d6" position={p} />
      <Burst spec={FIREBALL} birth={birth} position={p} />
      <Burst spec={SPARKS} birth={birth} position={p} />
      <Burst spec={DEBRIS} birth={birth} position={p} />
      <Burst spec={SMOKE} birth={birth} position={p} />
      <Ring birth={birth} life={0.7} from={0.3} to={2.2} color="#ffb46b" opacity={0.5} inner={0.9} position={p} />
      <Ring birth={birth + 0.05} life={1.3} from={0.4} to={1.9} color="#dff3ff" opacity={0.35} inner={0.7} position={p} />
      {side === 'enemy' && (
        <>
          <Glow birth={birth} life={0.18} size={1.9} color={PALETTE.accent} position={[p[0], 0.6, p[2]]} />
          <Burst spec={MERGE_SPARKS} birth={birth} position={p} />
          <Ring birth={birth} life={0.55} from={0.2} to={3.0} color={PALETTE.accent} opacity={0.75} inner={0.92} position={p} />
          <Callout birth={birth + 0.05} life={1.15} style="merged" title="MERGED" height={0.95} position={[p[0], 1.55, p[2]]} />
        </>
      )}
    </group>
  );
}

function Splash({ item }: { item: Item }) {
  const { birth, pos } = item;
  const p: [number, number, number] = [pos.x, 0.1, pos.z];
  return (
    <group>
      <Burst spec={WATER_COLUMN} birth={birth} position={p} />
      <Burst spec={WATER_CROWN} birth={birth} position={p} />
      <Burst spec={MIST} birth={birth} position={p} />
      <Ring birth={birth} life={0.5} from={0.05} to={0.75} color="#ffffff" opacity={0.6} inner={0} position={p} />
      <Ring birth={birth} life={1.2} from={0.3} to={2.4} color="#e8f7ff" opacity={0.7} inner={0.88} position={p} />
      <Ring birth={birth + 0.22} life={1.3} from={0.2} to={1.7} color="#bfe6ff" opacity={0.45} inner={0.86} position={p} />
    </group>
  );
}

const SINK_STAGGER = 0.17;

function SinkSequence({ item }: { item: Item }) {
  const { birth, pos, side, ship } = item;
  const cells = item.cells ?? [pos];
  const center = cells.reduce((acc, c) => acc.add(c), new THREE.Vector3()).multiplyScalar(1 / cells.length);
  const end = birth + cells.length * SINK_STAGGER;
  const c: [number, number, number] = [center.x, 0.2, center.z];
  const camera = useThree((st) => st.camera);
  const fired = useRef(-1);
  const enemy = side === 'enemy';
  useFrame(() => {
    const now = fxNow();
    const reduced = useGame.getState().settings.reducedMotion;
    const k = reduced ? 0.25 : 1;
    while (fired.current < cells.length && now >= birth + (fired.current + 1) * SINK_STAGGER) {
      fired.current++;
      if (fired.current < cells.length) addTrauma((enemy ? 0.16 : 0.1) * k);
      else {
        // the hull goes: hit-stop into slow-mo, white-hot flash, FOV punch
        addTrauma((enemy ? 0.85 : 0.5) * k);
        if (enemy) {
          if (!reduced) {
            slowMo(0.2, 0.34);
            fovPunch(camera, 3.2);
          }
          screenFlash(reduced ? 0.12 : 0.34, 0.42);
        } else {
          screenFlash(reduced ? 0.06 : 0.16, 0.35, '#ff7a6b');
        }
      }
    }
  });
  const ticket = ship ? TICKET_IDS[ship.id] ?? 'AF-1042' : 'AF-1042';
  return (
    <group>
      {cells.map((cell, i) => {
        const b = birth + i * SINK_STAGGER;
        const p: [number, number, number] = [cell.x, 0.4, cell.z];
        return (
          <group key={i}>
            <Glow birth={b} life={0.28} size={0.9} color="#fff1cf" position={p} />
            <Burst spec={MINI_FIREBALL} birth={b} position={p} />
            <Burst spec={MINI_SPARKS} birth={b} position={p} />
            <Burst spec={CHURN} birth={b} position={[cell.x, 0.1, cell.z]} />
          </group>
        );
      })}
      <Glow birth={end} life={0.45} size={enemy ? 2.6 : 2.0} color="#fff6e0" position={[center.x, 0.6, center.z]} />
      <Burst spec={FIREBALL} birth={end} position={[center.x, 0.5, center.z]} />
      <Burst spec={BIG_COLUMN} birth={end} position={c} />
      <Burst spec={DEBRIS} birth={end} position={c} />
      <Burst spec={EMBERS} birth={end} position={c} />
      <Burst spec={BIG_SMOKE} birth={end} position={c} />
      <Ring birth={end} life={1.0} from={0.5} to={5.2} color="#ffc07a" opacity={0.9} inner={0.9} position={c} />
      <Ring birth={end + 0.1} life={2.2} from={0.8} to={4.0} color="#dff3ff" opacity={0.5} inner={0.8} position={c} />
      {enemy ? (
        <>
          <Ring birth={end} life={0.8} from={0.4} to={7.0} color="#5dffa9" opacity={0.65} inner={0.95} position={c} />
          <Callout
            birth={end + 0.04}
            life={2.3}
            style="ticket"
            title="TICKET CLOSED"
            sub={`${ticket} \u00b7 ${ship?.name ?? 'Legacy code'}`}
            height={1.9}
            position={[center.x, 2.3, center.z]}
          />
        </>
      ) : (
        <Callout
          birth={end + 0.04}
          life={1.8}
          style="incident"
          title="SEV-1 INCIDENT"
          sub={`${ship?.name ?? 'Ship'} is down`}
          height={1.15}
          position={[center.x, 1.9, center.z]}
        />
      )}
    </group>
  );
}

function Sonar({ item }: { item: Item }) {
  const p: [number, number, number] = [item.pos.x, 0.09, item.pos.z];
  return (
    <group>
      <Ring birth={item.birth} life={0.9} from={0.25} to={1.3} color={PALETTE.accent} opacity={0.75} inner={0.84} position={p} />
      <Ring birth={item.birth + 0.12} life={0.9} from={0.2} to={0.9} color={PALETTE.accent} opacity={0.5} inner={0.8} position={p} />
    </group>
  );
}

/** Shrinking red lock-on brackets over your own fleet while the boss's missile is inbound. */
function IncomingWarning({ birth, pos }: { birth: number; pos: THREE.Vector3 }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (!g.current || !mat.current) return;
    const p = (fxNow() - birth) / FLIGHT;
    g.current.visible = p >= 0 && p <= 1;
    g.current.scale.setScalar(1.7 - p * 1.15);
    g.current.rotation.y = p * Math.PI * 0.75;
    mat.current.opacity = (0.55 + 0.45 * Math.sign(Math.sin(p * 38))) * 0.9;
  });
  return (
    <group ref={g} position={[pos.x, 0.55, pos.z]}>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <ringGeometry args={[0.5, 0.58, 4]} />
        <meshBasicMaterial ref={mat} color="#ff3b4f" transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ 3D callouts

type CalloutStyle = 'merged' | 'ticket' | 'incident';

const TICKET_IDS: Record<string, string> = {
  carrier: 'COBOL-1959',
  battleship: 'LEG-4096',
  cruiser: 'CVE-2014',
  submarine: 'FLAKY-404',
  destroyer: 'JIRA-9001',
};

const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};

function drawCallout(style: CalloutStyle, title: string, sub: string) {
  const W = style === 'ticket' ? 640 : style === 'incident' ? 560 : 420;
  const H = style === 'ticket' ? 224 : style === 'incident' ? 168 : 112;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const accent = style === 'incident' ? '#ff5d6c' : style === 'ticket' ? '#5dffa9' : PALETTE.accent;
  c.shadowColor = accent;
  c.shadowBlur = 18;
  roundRect(c, 12, 12, W - 24, H - 24, 22);
  c.fillStyle = 'rgba(4, 12, 16, 0.9)';
  c.fill();
  c.lineWidth = 5;
  c.strokeStyle = accent;
  c.stroke();
  c.shadowBlur = 0;
  // status glyph
  const gx = style === 'merged' ? 62 : 84;
  const gy = H / 2;
  const gr = style === 'merged' ? 26 : 40;
  c.beginPath();
  c.arc(gx, gy, gr, 0, Math.PI * 2);
  c.fillStyle = accent;
  c.fill();
  c.strokeStyle = '#04100c';
  c.lineWidth = gr * 0.28;
  c.lineCap = 'round';
  c.beginPath();
  if (style === 'incident') {
    c.moveTo(gx, gy - gr * 0.5);
    c.lineTo(gx, gy + gr * 0.12);
    c.moveTo(gx, gy + gr * 0.48);
    c.lineTo(gx, gy + gr * 0.5);
  } else {
    c.moveTo(gx - gr * 0.45, gy + gr * 0.02);
    c.lineTo(gx - gr * 0.1, gy + gr * 0.36);
    c.lineTo(gx + gr * 0.48, gy - gr * 0.34);
  }
  c.stroke();
  const tx = gx + gr + 24;
  c.textBaseline = 'middle';
  c.fillStyle = '#f4fff9';
  if (style === 'merged') {
    c.font = '900 46px ui-monospace, Menlo, monospace';
    c.fillText(title, tx, gy + 2);
  } else {
    c.font = `900 ${style === 'ticket' ? 58 : 48}px ui-monospace, Menlo, monospace`;
    c.fillText(title, tx, gy - (style === 'ticket' ? 26 : 20));
    c.font = `700 ${style === 'ticket' ? 34 : 30}px ui-monospace, Menlo, monospace`;
    c.fillStyle = accent;
    c.fillText(sub, tx, gy + (style === 'ticket' ? 34 : 28));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H };
}

/** Camera-facing chip that pops in over a cell, drifts up and fades. */
function Callout({
  birth,
  life,
  style,
  title,
  sub = '',
  height,
  position,
}: {
  birth: number;
  life: number;
  style: CalloutStyle;
  title: string;
  sub?: string;
  height: number;
  position: [number, number, number];
}) {
  const sprite = useRef<THREE.Sprite>(null);
  const mat = useRef<THREE.SpriteMaterial>(null);
  const art = useMemo(() => drawCallout(style, title, sub), [style, title, sub]);
  useEffect(() => () => art.tex.dispose(), [art]);
  useFrame(() => {
    if (!sprite.current || !mat.current) return;
    const a = fxNow() - birth;
    sprite.current.visible = a >= 0 && a <= life;
    if (!sprite.current.visible) return;
    const k = popIn(a / 0.42);
    sprite.current.scale.set(height * art.aspect * k, height * k, 1);
    sprite.current.position.set(position[0], position[1] + Math.min(a, 1.2) * 0.35, position[2]);
    mat.current.opacity = Math.min(1, (life - a) / 0.3);
  });
  return (
    <sprite ref={sprite} visible={false} renderOrder={30}>
      <spriteMaterial ref={mat} map={art.tex} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

const popIn = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 1 + Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) * 0.9;

// ------------------------------------------------------------------ screen flash

const flashState = { at: -99, peak: 0, life: 0.3, color: new THREE.Color('#fff3dc') };
/** Full-screen additive flash on real time (unaffected by slow-mo). */
const screenFlash = (peak: number, life: number, color = '#fff3dc') => {
  flashState.at = realNow();
  flashState.peak = peak;
  flashState.life = life;
  flashState.color.set(color);
};

function ScreenFlash() {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const camera = useThree((s) => s.camera);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!mesh.current || !mat.current) return;
    const p = (realNow() - flashState.at) / flashState.life;
    mesh.current.visible = p >= 0 && p < 1;
    if (!mesh.current.visible) return;
    camera.getWorldDirection(fwd);
    mesh.current.position.copy(camera.position).addScaledVector(fwd, 0.5);
    mesh.current.quaternion.copy(camera.quaternion);
    mat.current.color.copy(flashState.color);
    mat.current.opacity = flashState.peak * Math.pow(1 - p, 2);
  });
  return (
    <mesh ref={mesh} visible={false} renderOrder={999} frustumCulled={false}>
      <planeGeometry args={[4, 4]} />
      <meshBasicMaterial
        ref={mat}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

const fovPunch = (camera: THREE.Camera, amount: number) => {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov -= amount;
    camera.updateProjectionMatrix();
  }
};

const UP = new THREE.Vector3(0, 1, 0);

const TRAIL_VERT = /* glsl */ `
varying float vU;
void main() {
  vU = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Arc-length shaded ribbon: a hot head that cools into a short, quickly fading
// tail, plus a faint thread of the arc already flown that dissolves behind it.
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uHead;
uniform float uFade;
uniform float uTail;
uniform float uGain;
varying float vU;
void main() {
  float d = uHead - vU;
  if (d < 0.0) discard;
  float hot = 1.0 - smoothstep(0.0, uTail, d);
  float thread = 0.14 * (1.0 - smoothstep(0.0, 0.7, d));
  float a = (hot * hot + thread) * uFade * uGain;
  vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), hot * hot * 0.75);
  gl_FragColor = vec4(col * a, 1.0);
  #include <colorspace_fragment>
}`;

const makeTrailMaterial = (color: string, tail: number, gain: number) =>
  new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHead: { value: 0 },
      uFade: { value: 1 },
      uTail: { value: tail },
      uGain: { value: gain },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

/** Accelerating flight profile: arc-length fraction flown at flight progress p. */
const flightEase = (p: number) => 0.55 * p + 0.45 * p * p;
const flightTimeAt = (u: number) => ((-0.55 + Math.sqrt(0.3025 + 1.8 * u)) / 0.9) * FLIGHT;

function Missile({ item }: { item: Item }) {
  const { birth, side } = item;
  const realBirth = item.realBirth ?? realNow();
  const start = item.start!;
  const color = side === 'enemy' ? PALETTE.accent : PALETTE.enemy;
  const body = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);

  const kit = useMemo(() => {
    const end = new THREE.Vector3(item.pos.x, 0.22, item.pos.z);
    const mid = start.clone().lerp(end, 0.5);
    // your shots lob low and bow sideways so the climb never reads as a vertical column
    const lift = side === 'enemy' ? 3.4 : 2.6;
    const bow = (side === 'enemy' ? 1.7 : 0.8) * (item.id % 2 ? 1 : -1);
    const ctrl = mid.add(new THREE.Vector3(bow, lift * 2, 0));
    ctrl.y = Math.max(ctrl.y, Math.max(start.y, end.y) + 1.2);
    const curve = new THREE.QuadraticBezierCurve3(start.clone(), ctrl, end);
    const core = new THREE.TubeGeometry(curve, 72, 0.045, 6, false);
    const glow = new THREE.TubeGeometry(curve, 72, 0.15, 8, false);
    const coreMat = makeTrailMaterial(color, 0.16, 1);
    const glowMat = makeTrailMaterial(color, 0.22, 0.32);
    const puffN = 46;
    const tmp = new THREE.Vector3();
    const puffs = makeParticleGeometry(puffN, (i, o) => {
      const u = 0.05 + (i / puffN) * 0.9;
      curve.getPointAt(u, tmp);
      o.pos = [tmp.x, tmp.y, tmp.z];
      o.vel = [rand(-0.12, 0.12), rand(0, 0.1), rand(-0.12, 0.12)];
      o.delay = flightTimeAt(u);
      o.life = rand(0.32, 0.6);
      o.size = rand(0.14, 0.22);
    });
    const puffMat = makeParticleMaterial(
      { colors: ['#eef2f7', '#b8c1cc', '#7d8693'], opacity: 0.2, sizeStart: 0.8, sizeEnd: 2.1, drag: 2, soft: 2, fadeIn: 0.04 },
      birth,
    );
    return { curve, core, glow, coreMat, glowMat, puffs, puffMat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      kit.core.dispose();
      kit.glow.dispose();
      kit.coreMat.dispose();
      kit.glowMat.dispose();
      kit.puffs.dispose();
      kit.puffMat.dispose();
    },
    [kit],
  );

  useEffect(() => {
    flashLight({ pos: start.clone(), color, peak: 18, life: 0.3, distance: 7 });
    flashLight({ pos: start.clone(), color, peak: 7, life: FLIGHT, distance: 6, follow: body.current });
  }, [start, color]);

  const cur = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    // flight runs on real time so the warhead lands exactly when the store resolves the shot
    const p = (realNow() - realBirth) / FLIGHT;
    const u = flightEase(THREE.MathUtils.clamp(p, 0, 1));
    const fade = p < 1 ? 1 : Math.max(0, 1 - (p - 1) * FLIGHT / 0.3);
    for (const m of [kit.coreMat, kit.glowMat]) {
      m.uniforms.uHead.value = u;
      m.uniforms.uFade.value = fade;
    }
    if (!body.current) return;
    body.current.visible = p >= 0 && p < 1;
    if (!body.current.visible) return;
    kit.curve.getPointAt(u, cur);
    kit.curve.getTangentAt(u, tan);
    body.current.position.copy(cur);
    body.current.quaternion.setFromUnitVectors(UP, tan.normalize());
    if (flame.current) {
      const f = 0.8 + Math.random() * 0.45;
      flame.current.scale.set(f, 0.8 + Math.random() * 0.7, f);
    }
  });

  return (
    <group>
      <mesh geometry={kit.glow} material={kit.glowMat} frustumCulled={false} renderOrder={4} />
      <mesh geometry={kit.core} material={kit.coreMat} frustumCulled={false} renderOrder={5} />
      <points geometry={kit.puffs} material={kit.puffMat} frustumCulled={false} />
      <Glow birth={birth} life={0.25} size={0.9} color={color} position={[start.x, start.y, start.z]} />
      <Burst spec={MUZZLE_SMOKE} birth={birth} position={[start.x, start.y, start.z]} />
      {side === 'player' && <IncomingWarning birth={birth} pos={item.pos} />}
      <group ref={body} visible={false} scale={1.55}>
        {/* fuselage */}
        <mesh>
          <cylinderGeometry args={[0.07, 0.075, 0.5, 12]} />
          <meshStandardMaterial color="#e8edf3" metalness={0.3} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.076, 0.076, 0.07, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <coneGeometry args={[0.07, 0.2, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} roughness={0.3} />
        </mesh>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} position={[Math.cos((k * Math.PI) / 2) * 0.09, -0.19, Math.sin((k * Math.PI) / 2) * 0.09]} rotation={[0, -(k * Math.PI) / 2, 0]}>
            <boxGeometry args={[0.09, 0.13, 0.012]} />
            <meshStandardMaterial color="#9aa6b4" metalness={0.3} roughness={0.4} />
          </mesh>
        ))}
        {/* exhaust flame */}
        <mesh ref={flame} position={[0, -0.36, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.065, 0.28, 10]} />
          <meshBasicMaterial color="#fff1c9" transparent opacity={0.95} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh position={[0, -0.3, 0]}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ layer

const LIFE: Record<Kind, number> = {
  sonar: 1.2,
  missile: FLIGHT + 1.8,
  splash: 2.2,
  explosion: 3.4,
  sink: 6.5,
};

function missileStart(side: BoardSide, coord: { x: number; y: number }): THREE.Vector3 {
  const [cx] = cellToWorld(coord);
  if (side === 'player') {
    // the boss fires from the shoulder pod on the target's side
    const sx = cx >= 0 ? 1 : -1;
    return new THREE.Vector3(
      LEGACY_MONOLITH_POSITION[0] + sx * BOSS_POD_LOCAL[0] * LEGACY_MONOLITH_SCALE[0],
      LEGACY_MONOLITH_POSITION[1] + BOSS_POD_LOCAL[1] * LEGACY_MONOLITH_SCALE[1],
      LEGACY_MONOLITH_POSITION[2] + BOSS_POD_LOCAL[2] * LEGACY_MONOLITH_SCALE[2],
    );
  }
  // your fleet fires: launch from the surviving ship closest to the target column
  const m = useGame.getState().match;
  const alive = m?.player.ships.filter((s) => !s.sunk) ?? [];
  let best: THREE.Vector3 | null = null;
  let bestD = Infinity;
  for (const s of alive) {
    const mid = s.cells[Math.floor(s.cells.length / 2)];
    const w = cellWorld('player', mid);
    const d = Math.abs(w.x - cx) + (w.z - PLAYER_BOARD_POS[2]) * 0.15;
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  if (best) return best.setY(0.62);
  return new THREE.Vector3(cx + (cx >= 0 ? -3.2 : 3.2), 0.9, PLAYER_BOARD_POS[2] - 4.85);
}

export function EffectsLayer() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const shakeOffset = useRef(new THREE.Vector3());
  const camera = useThree((s) => s.camera);
  const size = useRef(new THREE.Vector2());

  useEffect(
    () =>
      fx.subscribe((e) => {
        if (e.type === 'marker' || e.type === 'bossMood') return; // markers come from board state, not fx
        const birth = fxNow();
        const pos = cellWorld(e.side, e.coord);
        const item: Item = { id: nextId++, kind: e.type, birth, life: LIFE[e.type], side: e.side, pos };
        const reduced = useGame.getState().settings.reducedMotion;
        const k = reduced ? 0.25 : 1;
        switch (e.type) {
          case 'missile':
            item.start = missileStart(e.side, e.coord);
            item.realBirth = realNow();
            break;
          case 'explosion':
            if (e.side === 'enemy') {
              // your hit: brighter flash, harder kick, a 60ms hit-stop and a small FOV punch
              flashLight({ pos: pos.clone().setY(1.0), color: '#ffc27a', peak: 60, life: 0.6, distance: 14 });
              addTrauma(0.44 * k);
              if (!reduced) {
                slowMo(0.08, 0.06);
                fovPunch(camera, 0.9);
              }
            } else {
              flashLight({ pos: pos.clone().setY(1.0), color: '#ffab47', peak: 36, life: 0.5, distance: 11 });
              addTrauma(0.3 * k);
            }
            break;
          case 'splash':
            flashLight({ pos: pos.clone().setY(0.8), color: '#bfe6ff', peak: 7, life: 0.4, distance: 6 });
            addTrauma((e.side === 'enemy' ? 0.06 : 0.08) * k);
            break;
          case 'sink': {
            const ship = shipAt(e.side, e.coord);
            item.cells = ship ? ship.cells.map((c) => cellWorld(e.side, c)) : [pos];
            if (ship) {
              const name = e.side === 'enemy' ? ENEMY_FLEET_NAMES[ship.spec.id] ?? ship.spec.name : ship.spec.name;
              item.ship = { id: ship.spec.id, name };
            }
            const cells = item.cells;
            // fixed pool of 4 lights: every other cell, then the big one
            cells.forEach((c, i) => {
              if (i % 2 === 0) flashLight({ pos: c.clone().setY(1.0), color: '#ff9a3c', peak: 26, life: 0.35, distance: 9 }, i * SINK_STAGGER);
            });
            const mid = cells[Math.floor(cells.length / 2)];
            const big = e.side === 'enemy' ? 90 : 60;
            flashLight({ pos: mid.clone().setY(1.6), color: '#ffb35c', peak: big, life: 0.9, distance: 16 }, cells.length * SINK_STAGGER);
            break;
          }
        }
        setItems((cur) => [...cur, item]);
      }),
    [camera],
  );

  useFrame(({ gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    tickFx(dt);
    gl.getDrawingBufferSize(size.current);
    fxUniforms.uResY.value = size.current.y;

    const now = fxNow();
    if (itemsRef.current.some((i) => now - i.birth > i.life)) {
      setItems((cur) => cur.filter((i) => now - i.birth <= i.life));
    }

    // pooled flash lights — fixed count so no shader recompiles
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const L = lights.current[i];
      const req = lightSlots[i];
      if (!L) continue;
      if (!req) {
        L.intensity = 0;
        continue;
      }
      const p = (now - req.birth) / req.life;
      if (p < 0 || p > 1) {
        L.intensity = 0;
        continue;
      }
      L.intensity = req.peak * (1 - p) * (1 - p);
      L.color.set(req.color);
      L.distance = req.distance;
      if (req.follow && req.follow.visible) req.follow.getWorldPosition(L.position);
      else if (!req.follow) L.position.copy(req.pos);
      else L.intensity = 0;
    }

    // camera trauma shake (undo last frame's offset, apply a new one)
    camera.position.sub(shakeOffset.current);
    const t = takeTrauma(dt);
    const s = t * t * 0.55;
    const rt = realNow();
    shakeOffset.current.set(
      Math.sin(rt * 61.3) * s + Math.sin(rt * 23.1) * s * 0.5,
      Math.sin(rt * 53.7 + 1.3) * s * 0.7,
      Math.sin(rt * 47.9 + 2.1) * s * 0.4,
    );
    camera.position.add(shakeOffset.current);
  });

  return (
    <group>
      <ScreenFlash />
      {Array.from({ length: LIGHT_POOL_SIZE }).map((_, i) => (
        <pointLight key={i} ref={(l) => { lights.current[i] = l; }} intensity={0} distance={10} decay={2} />
      ))}
      {items.map((i) => {
        switch (i.kind) {
          case 'sonar':
            return <Sonar key={i.id} item={i} />;
          case 'missile':
            return <Missile key={i.id} item={i} />;
          case 'splash':
            return <Splash key={i.id} item={i} />;
          case 'explosion':
            return <Explosion key={i.id} item={i} />;
          case 'sink':
            return <SinkSequence key={i.id} item={i} />;
          default:
            return null;
        }
      })}
    </group>
  );
}
