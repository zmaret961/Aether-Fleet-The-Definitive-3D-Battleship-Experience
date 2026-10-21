import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../state/store';
import type { Phase } from '../state/store';
import { BOARD_HALF, ENEMY_BOARD_POS, PALETTE, PLAYER_BOARD_POS, PLAYER_BOARD_SCALE } from './config';

// Four directional swells summed in both shaders so the fragment normal
// matches the vertex displacement exactly.
const WAVES = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  vec3 waveField(vec2 p) {
    // returns (height, dh/dx, dh/dz)
    vec3 acc = vec3(0.0);
    vec2 dirs[4];
    dirs[0] = normalize(vec2(1.0, 0.35));
    dirs[1] = normalize(vec2(-0.6, 1.0));
    dirs[2] = normalize(vec2(0.2, -1.0));
    dirs[3] = normalize(vec2(1.0, -0.8));
    float freq[4];
    freq[0] = 0.42; freq[1] = 0.74; freq[2] = 1.35; freq[3] = 2.3;
    float amp[4];
    amp[0] = 0.5; amp[1] = 0.28; amp[2] = 0.14; amp[3] = 0.06;
    float speed[4];
    speed[0] = 0.7; speed[1] = 1.0; speed[2] = 1.45; speed[3] = 2.0;
    for (int i = 0; i < 4; i++) {
      float ph = dot(p, dirs[i]) * freq[i] + uTime * speed[i];
      acc.x += sin(ph) * amp[i];
      float d = cos(ph) * amp[i] * freq[i];
      acc.y += d * dirs[i].x;
      acc.z += d * dirs[i].y;
    }
    return acc * uAmp;
  }
`;

const VERT = /* glsl */ `
  ${WAVES}
  varying vec3 vWorld;
  varying float vElev;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 w = waveField(world.xz);
    world.y += w.x;
    vElev = w.x / max(uAmp, 0.001);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  ${WAVES}
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uScatter;
  uniform vec3 uAccent;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uKeyDir;
  uniform float uSparkle;
  // board footprints for foam: xy = centre (world xz), z = half extent, w = strength
  uniform vec4 uBoardA;
  uniform vec4 uBoardB;
  varying vec3 vWorld;
  varying float vElev;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // Mid + fine ripple field, only used to perturb normals (no geometry cost).
  vec2 rippleGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    float ph;
    ph = p.x * 1.10 + p.y * 0.62 + t * 1.05; g += cos(ph) * vec2(1.10, 0.62) * 0.085;
    ph = -p.x * 0.74 + p.y * 1.32 + t * 1.25; g += cos(ph) * vec2(-0.74, 1.32) * 0.07;
    ph = p.x * 3.1 + p.y * 1.3 + t * 1.6;  g += cos(ph) * vec2(3.1, 1.3) * 0.032;
    ph = -p.x * 1.7 + p.y * 3.6 + t * 1.9; g += cos(ph) * vec2(-1.7, 3.6) * 0.026;
    ph = p.x * 5.3 - p.y * 4.1 - t * 2.6;  g += cos(ph) * vec2(5.3, -4.1) * 0.014;
    ph = p.x * 8.9 + p.y * 7.7 + t * 3.3;  g += cos(ph) * vec2(8.9, 7.7) * 0.008;
    return g;
  }

  float boxSdf(vec2 p, vec4 b) {
    vec2 q = abs(p - b.xy) - vec2(b.z);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }

  // lacy foam band hugging a board's frame, broken up by drifting noise
  float frameFoam(vec2 p, vec4 b, float t) {
    if (b.w <= 0.0) return 0.0;
    float d = boxSdf(p, b);
    float reach = 0.32 + 0.12 * sin(t * 0.8 + p.x * 0.9 + p.y * 0.7);
    float band = smoothstep(-0.03, 0.04, d) * (1.0 - smoothstep(0.02, reach, d));
    float n = vnoise(p * 6.5 + vec2(t * 0.45, -t * 0.3)) * 0.6 + vnoise(p * 17.0 - t * 0.7) * 0.4;
    float lace = smoothstep(0.48, 0.8, n + band * 0.25);
    // a crisp contact line where the water meets the pontoon
    float contact = (1.0 - smoothstep(0.0, 0.05, abs(d - 0.01))) * 0.55;
    return max(band * lace, contact * smoothstep(0.3, 0.6, n)) * b.w;
  }

  void main() {
    vec3 w = waveField(vWorld.xz);
    float dist = distance(cameraPosition, vWorld);
    // fade ripples with distance so they never alias into glitter
    vec2 rg = rippleGrad(vWorld.xz, uTime) / (1.0 + dist * 0.045);
    vec3 n = normalize(vec3(-(w.y + rg.x), 1.0, -(w.z + rg.y)));
    vec3 viewDir = normalize(cameraPosition - vWorld);

    float ndv = max(dot(n, viewDir), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

    // body: deep troughs, teal light scattering through lit crest faces
    float crest = smoothstep(-0.2, 0.9, vElev);
    float lit = max(dot(n, uKeyDir), 0.0);
    vec3 body = mix(uDeep, uShallow, 0.35 + crest * 0.35);
    body *= 0.78 + lit * 0.36;
    float scatter = pow(max(dot(n, normalize(vec3(uSunDir.x, 0.0, uSunDir.z) * -0.4 + vec3(0.0, 1.0, 0.0))), 0.0), 3.0);
    body += uScatter * crest * (0.18 + scatter * 0.22);

    // reflected sky gradient
    vec3 r = reflect(-viewDir, n);
    float up = clamp(r.y, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon * 1.25, uSkyTop, pow(up, 0.5));
    vec3 col = mix(body, sky, clamp(fres * 1.1, 0.0, 0.9));

    // broad key-light sheen: the wave relief catching the light near camera
    vec3 hk = normalize(uKeyDir + viewDir);
    col += vec3(0.62, 0.78, 0.95) * pow(max(dot(n, hk), 0.0), 70.0) * 0.1;
    // fine capillary ripples glinting in the key light: the water's visible texture up close
    vec2 fg = vec2(0.0);
    float fp;
    fp = vWorld.x * 11.0 + vWorld.z * 5.0 + uTime * 2.4;  fg += cos(fp) * vec2(11.0, 5.0);
    fp = -vWorld.x * 6.0 + vWorld.z * 12.5 + uTime * 2.9; fg += cos(fp) * vec2(-6.0, 12.5);
    fp = vWorld.x * 17.0 - vWorld.z * 13.0 - uTime * 3.6; fg += cos(fp) * vec2(17.0, -13.0) * 0.6;
    float fineFade = 1.0 / (1.0 + dist * 0.09);
    vec3 nf = normalize(n + vec3(-fg.x, 0.0, -fg.y) * 0.012 * fineFade);
    float rippleSpec = pow(max(dot(nf, hk), 0.0), 140.0);
    col += vec3(0.55, 0.75, 0.95) * rippleSpec * 0.22 * fineFade * (0.4 + crest * 0.8);

    // restrained moon path: soft column + a tight glint core, faded with haze
    float sd = max(dot(r, uSunDir), 0.0);
    float haze = 1.0 - exp(-pow(dist * 0.026, 1.8));
    float glint = pow(sd, 380.0) * 0.9 + pow(sd, 48.0) * 0.07;
    col += vec3(1.0, 0.93, 0.82) * min(glint, 1.1) * (1.0 - haze * 0.55);

    // tiny crest sparkles, sparse and twinkling (never blobby)
    vec2 cell = floor(vWorld.xz * 9.0);
    float h = hash(cell);
    float tw = pow(0.5 + 0.5 * sin(uTime * (2.0 + h * 3.0) + h * 40.0), 6.0);
    float sparkle = step(0.993, h) * tw * crest * uSparkle / (1.0 + dist * 0.12);
    col += uAccent * sparkle * 0.3;

    // foam lapping at the board frames
    float foam = max(frameFoam(vWorld.xz, uBoardA, uTime), frameFoam(vWorld.xz, uBoardB, uTime));
    // whitecap hints on the tallest crests, far apart and faint
    float capN = vnoise(vWorld.xz * vec2(9.0, 4.0) + uTime * 0.3) * 0.6 + vnoise(vWorld.xz * 21.0) * 0.4;
    foam = max(foam, smoothstep(0.82, 1.0, vElev) * smoothstep(0.66, 0.9, capN) * 0.22 / (1.0 + dist * 0.03));
    col = mix(col, vec3(0.74, 0.86, 0.94) * (0.55 + lit * 0.45), clamp(foam, 0.0, 1.0) * 0.42);

    // distance haze into the sky horizon colour
    col = mix(col, uSkyHorizon, haze);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const SKY_TOP = '#030914';
export const SKY_HORIZON = '#123653';
/** Low moon behind the boss: its glint path runs down the water toward camera. */
export const SUN_DIR = new THREE.Vector3(0.38, 0.13, -1).normalize();
const KEY_DIR = new THREE.Vector3(-9, 16, 8).normalize();

const NO_BOARD = new THREE.Vector4(0, 0, 0, 0);
const frameHalf = BOARD_HALF + 0.32;

/** Where the boards float this phase, so the water can foam around their frames. */
function boardFoam(phase: Phase, a: THREE.Vector4, b: THREE.Vector4) {
  if (phase === 'battle' || phase === 'over') {
    a.set(ENEMY_BOARD_POS[0], ENEMY_BOARD_POS[2], frameHalf, 1);
    b.set(PLAYER_BOARD_POS[0], PLAYER_BOARD_POS[2], frameHalf * PLAYER_BOARD_SCALE, 1);
  } else if (phase === 'deploy') {
    a.set(0, 0, frameHalf, 1);
    b.copy(NO_BOARD);
  } else {
    a.copy(NO_BOARD);
    b.copy(NO_BOARD);
  }
}

export function Ocean({ amp = 0.16, caustics = 0.9, segments = 96 }: { amp?: number; caustics?: number; segments?: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: amp },
      uDeep: { value: new THREE.Color('#041627') },
      uShallow: { value: new THREE.Color('#0d3a5a') },
      uScatter: { value: new THREE.Color('#1f7f93') },
      uAccent: { value: new THREE.Color(PALETTE.accent) },
      uSkyTop: { value: new THREE.Color(SKY_TOP) },
      uSkyHorizon: { value: new THREE.Color(SKY_HORIZON) },
      uSunDir: { value: SUN_DIR.clone() },
      uKeyDir: { value: KEY_DIR.clone() },
      uSparkle: { value: caustics },
      uBoardA: { value: new THREE.Vector4() },
      uBoardB: { value: new THREE.Vector4() },
    }),
    [amp, caustics],
  );
  useFrame((_, dt) => {
    const m = mat.current;
    if (!m) return;
    m.uniforms.uTime.value += dt;
    boardFoam(useGame.getState().phase, m.uniforms.uBoardA.value, m.uniforms.uBoardB.value);
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} frustumCulled={false}>
      <planeGeometry args={[300, 300, segments * 3, segments * 3]} />
      <shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  );
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uAccent;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float e = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    // three-stop night gradient: lifted teal horizon -> blue mid -> ink zenith
    vec3 mid = mix(uHorizon, uTop, 0.55);
    vec3 col = mix(uHorizon * 1.35, mid, smoothstep(0.0, 0.16, h));
    col = mix(col, uTop, smoothstep(0.12, 0.7, h));
    // thin cyan skyline glow — the Cognition light on the horizon
    col += uAccent * exp(-abs(d.y) * 26.0) * 0.09;
    // long, faint stratus bands catching moonlight
    vec2 cp = d.xz / max(d.y + 0.08, 0.08);
    float cloud = smoothstep(0.55, 0.85, vnoise(cp * vec2(0.35, 1.4)) * 0.7 + vnoise(cp * 1.7) * 0.3);
    float moonSide = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
    col += vec3(0.32, 0.42, 0.55) * cloud * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.25, 0.5, h)) * (0.05 + moonSide * 0.12);
    // moon: crisp disc, soft halo
    float s = max(dot(d, uSunDir), 0.0);
    col += vec3(0.55, 0.7, 0.9) * pow(s, 40.0) * 0.22 + vec3(0.6, 0.75, 0.95) * pow(s, 400.0) * 0.4;
    col += vec3(1.0, 0.97, 0.9) * smoothstep(0.99955, 0.9997, s) * 1.1;
    // sparse stars high up
    vec3 q = floor(d * 260.0);
    float st = step(0.9965, hash(q)) * smoothstep(0.15, 0.6, d.y);
    col += vec3(0.8, 0.9, 1.0) * st * 0.7;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Gradient sky dome with horizon glow, moon halo and a few stars. */
export function SkyDome() {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(SKY_TOP) },
      uHorizon: { value: new THREE.Color(SKY_HORIZON) },
      uAccent: { value: new THREE.Color(PALETTE.accentSoft) },
      uSunDir: { value: SUN_DIR.clone() },
    }),
    [],
  );
  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[320, 32, 16]} />
      <shaderMaterial
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}
