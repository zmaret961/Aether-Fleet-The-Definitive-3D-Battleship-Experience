import * as THREE from 'three';
import { useGame } from '../state/store';
import type { BoardSide } from '../state/fx';
import type { Coord, PlacedShip } from '../game/types';
import { cellToWorld, ENEMY_BOARD_POS, PLAYER_BOARD_POS } from './config';

/**
 * Shared FX toolkit: one GPU particle shader (motion is solved in the vertex
 * shader from a birth time, so bursts cost no per-frame CPU work), a shared
 * clock, camera trauma and a fixed light pool so flashes never change the
 * scene's light count (which would force every material to recompile).
 */
export const fxUniforms = {
  uTime: { value: 0 },
  uResY: { value: 900 },
};

export const fxNow = () => fxUniforms.uTime.value;

// ---------------------------------------------------------------- camera trauma
let trauma = 0;
export const addTrauma = (amount: number) => {
  trauma = Math.min(1, trauma + amount);
};
export const takeTrauma = (dt: number) => {
  const t = trauma;
  trauma = Math.max(0, trauma - dt * 1.6);
  return t;
};

// ---------------------------------------------------------------- light pool
export interface LightRequest {
  pos: THREE.Vector3;
  color: string;
  peak: number;
  life: number;
  birth: number;
  distance: number;
  follow?: THREE.Object3D | null;
}
export const LIGHT_POOL_SIZE = 4;
export const lightSlots: (LightRequest | null)[] = Array.from({ length: LIGHT_POOL_SIZE }, () => null);
export const flashLight = (req: Omit<LightRequest, 'birth'>) => {
  let slot = lightSlots.findIndex((l) => !l || fxNow() - l.birth > l.life);
  if (slot < 0) {
    let oldest = 0;
    lightSlots.forEach((l, i) => {
      if (l && lightSlots[oldest] && l.birth < lightSlots[oldest]!.birth) oldest = i;
    });
    slot = oldest;
  }
  lightSlots[slot] = { ...req, birth: fxNow() };
};

// ---------------------------------------------------------------- board helpers
export const boardBase = (side: BoardSide) => (side === 'player' ? PLAYER_BOARD_POS : ENEMY_BOARD_POS);

export const cellWorld = (side: BoardSide, c: Coord): THREE.Vector3 => {
  const [x, z] = cellToWorld(c);
  const b = boardBase(side);
  return new THREE.Vector3(x + b[0], 0, z + b[2]);
};

export const shipAt = (side: BoardSide, c: Coord): PlacedShip | null => {
  const m = useGame.getState().match;
  if (!m) return null;
  const board = side === 'player' ? m.player : m.enemy;
  return board.ships.find((s) => s.cells.some((cell) => cell.x === c.x && cell.y === c.y)) ?? null;
};

// ---------------------------------------------------------------- particles
const VERT = /* glsl */ `
uniform float uTime;
uniform float uBirth;
uniform float uResY;
uniform float uGravity;
uniform float uDrag;
uniform float uSizeStart;
uniform float uSizeEnd;
uniform float uLoop;
uniform float uFloor;
uniform vec3 uWind;
attribute vec3 aVel;
attribute float aDelay;
attribute float aLife;
attribute float aSize;
attribute float aSeed;
varying float vT;
varying float vSeed;
void main() {
  float age = uTime - uBirth - aDelay;
  if (uLoop > 0.5) age = mod(uTime + aDelay, aLife);
  float t = age / aLife;
  vT = t;
  vSeed = aSeed;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float k = uDrag > 0.0 ? (1.0 - exp(-uDrag * age)) / uDrag : age;
  vec3 p = position + aVel * k + uWind * age;
  p.y += 0.5 * uGravity * age * age;
  if (p.y < uFloor) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aSize * mix(uSizeStart, uSizeEnd, sqrt(t));
  gl_PointSize = max(1.0, size * projectionMatrix[1][1] * uResY * 0.5 / -mv.z);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uOpacity;
uniform float uSoft;
uniform float uFadeIn;
varying float vT;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, uSoft);
  vec3 col = vT < 0.35 ? mix(uColorA, uColorB, vT / 0.35) : mix(uColorB, uColorC, (vT - 0.35) / 0.65);
  float fade = smoothstep(0.0, uFadeIn, vT) * (1.0 - smoothstep(0.5, 1.0, vT));
  gl_FragColor = vec4(col * (0.85 + 0.3 * vSeed), a * fade * uOpacity);
  #include <colorspace_fragment>
}
`;

export interface ParticleLook {
  colors: [string, string, string];
  opacity?: number;
  additive?: boolean;
  soft?: number;
  gravity?: number;
  drag?: number;
  sizeStart?: number;
  sizeEnd?: number;
  loop?: boolean;
  floor?: number;
  wind?: [number, number, number];
  fadeIn?: number;
}

export function makeParticleMaterial(look: ParticleLook, birth = fxNow()) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: fxUniforms.uTime,
      uResY: fxUniforms.uResY,
      uBirth: { value: birth },
      uGravity: { value: look.gravity ?? 0 },
      uDrag: { value: look.drag ?? 0 },
      uSizeStart: { value: look.sizeStart ?? 1 },
      uSizeEnd: { value: look.sizeEnd ?? 1 },
      uLoop: { value: look.loop ? 1 : 0 },
      uFloor: { value: look.floor ?? -100 },
      uWind: { value: new THREE.Vector3(...(look.wind ?? [0, 0, 0])) },
      uColorA: { value: new THREE.Color(look.colors[0]) },
      uColorB: { value: new THREE.Color(look.colors[1]) },
      uColorC: { value: new THREE.Color(look.colors[2]) },
      uOpacity: { value: look.opacity ?? 1 },
      uSoft: { value: look.soft ?? 1.5 },
      uFadeIn: { value: look.fadeIn ?? 0.06 },
    },
  });
}

export interface ParticleInit {
  pos: [number, number, number];
  vel: [number, number, number];
  delay: number;
  life: number;
  size: number;
}

export function makeParticleGeometry(count: number, init: (i: number, out: ParticleInit) => void) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  const life = new Float32Array(count);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const out: ParticleInit = { pos: [0, 0, 0], vel: [0, 0, 0], delay: 0, life: 1, size: 0.1 };
  for (let i = 0; i < count; i++) {
    out.pos = [0, 0, 0];
    out.vel = [0, 0, 0];
    out.delay = 0;
    out.life = 1;
    out.size = 0.1;
    init(i, out);
    pos.set(out.pos, i * 3);
    vel.set(out.vel, i * 3);
    delay[i] = out.delay;
    life[i] = out.life;
    size[i] = out.size;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Random unit vector, optionally biased to the upper hemisphere. */
export const randDir = (upper = false): [number, number, number] => {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [r * Math.cos(th), upper ? Math.abs(u) : u, r * Math.sin(th)];
};

/** Preset burst description: radial "ring" (flat spray) or full "sphere". */
export interface BurstSpec extends ParticleLook {
  count: number;
  life: [number, number];
  speed: [number, number];
  up?: [number, number];
  size: [number, number];
  spread?: number;
  spreadY?: number;
  delay?: [number, number];
  shape?: 'ring' | 'sphere' | 'hemi';
}

export function burstGeometry(spec: BurstSpec) {
  return makeParticleGeometry(spec.count, (_, o) => {
    const sp = spec.spread ?? 0;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * sp;
    o.pos = [Math.cos(a) * r, (Math.random() - 0.5) * (spec.spreadY ?? 0), Math.sin(a) * r];
    const speed = rand(spec.speed[0], spec.speed[1]);
    const up = spec.up ? rand(spec.up[0], spec.up[1]) : 0;
    if (spec.shape === 'sphere' || spec.shape === 'hemi') {
      const d = randDir(spec.shape === 'hemi');
      o.vel = [d[0] * speed, d[1] * speed + up, d[2] * speed];
    } else {
      const b = Math.random() * Math.PI * 2;
      o.vel = [Math.cos(b) * speed, up, Math.sin(b) * speed];
    }
    o.life = rand(spec.life[0], spec.life[1]);
    o.size = rand(spec.size[0], spec.size[1]);
    o.delay = spec.delay ? rand(spec.delay[0], spec.delay[1]) : 0;
  });
}

export const burstDuration = (spec: BurstSpec) => spec.life[1] + (spec.delay?.[1] ?? 0);

// ---------------------------------------------------------------- presets
export const FIREBALL: BurstSpec = {
  count: 26, life: [0.45, 0.85], speed: [0.6, 1.8], up: [0.4, 1.2], size: [0.7, 1.25], shape: 'sphere',
  drag: 3.2, sizeStart: 0.5, sizeEnd: 1.5, colors: ['#fff6d8', '#ff9330', '#7a1c08'], additive: true, soft: 1.2, opacity: 0.95,
};
export const SPARKS: BurstSpec = {
  count: 70, life: [0.55, 1.1], speed: [2.5, 6.0], up: [1.5, 4.0], size: [0.06, 0.12], shape: 'hemi',
  gravity: -9.8, drag: 0.6, sizeStart: 1, sizeEnd: 0.4, colors: ['#ffffff', '#ffd27a', '#ff6a1a'], additive: true, soft: 0.6, floor: 0.02,
};
export const DEBRIS: BurstSpec = {
  count: 22, life: [0.8, 1.3], speed: [1.5, 3.5], up: [3.0, 5.5], size: [0.08, 0.15], shape: 'ring',
  gravity: -11, colors: ['#3b3f46', '#25282d', '#15171a'], opacity: 0.95, soft: 0.2, floor: 0.0,
};
export const SMOKE: BurstSpec = {
  count: 18, life: [1.6, 2.6], speed: [0.2, 0.6], up: [0.6, 1.3], size: [0.6, 1.0], spread: 0.25, delay: [0.08, 0.35],
  drag: 1.2, sizeStart: 0.5, sizeEnd: 2.1, wind: [0.25, 0.05, -0.1], colors: ['#3c3530', '#2a2c31', '#4a5059'], opacity: 0.55, soft: 1.6, fadeIn: 0.15,
};
export const WATER_COLUMN: BurstSpec = {
  count: 80, life: [0.9, 1.4], speed: [0.1, 0.7], up: [4.2, 7.2], size: [0.12, 0.28], spread: 0.22,
  gravity: -12, sizeStart: 0.8, sizeEnd: 1.4, colors: ['#ffffff', '#d8f1ff', '#8fc8e8'], opacity: 0.9, soft: 0.9, floor: 0.0,
};
export const WATER_CROWN: BurstSpec = {
  count: 46, life: [0.6, 1.0], speed: [1.6, 2.8], up: [2.0, 3.6], size: [0.07, 0.14], spread: 0.3,
  gravity: -11, colors: ['#ffffff', '#cdeeff', '#7fb8d9'], opacity: 0.9, soft: 0.7, floor: 0.0,
};
export const MIST: BurstSpec = {
  count: 14, life: [1.1, 1.8], speed: [0.4, 0.9], up: [0.6, 1.4], size: [0.8, 1.3], spread: 0.3, delay: [0.05, 0.2],
  drag: 1.8, sizeStart: 0.6, sizeEnd: 1.8, colors: ['#e7f6ff', '#b9dcf0', '#6f9fbf'], opacity: 0.32, soft: 1.8, fadeIn: 0.1,
};
