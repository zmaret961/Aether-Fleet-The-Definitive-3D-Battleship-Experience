import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from './config';

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
  uniform vec3 uAccent;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunDir;
  uniform float uSparkle;
  varying vec3 vWorld;
  varying float vElev;

  // Fine, fast ripple field — only ever used to perturb normals.
  vec2 rippleGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    float ph;
    ph = p.x * 3.1 + p.y * 1.3 + t * 1.6;  g += cos(ph) * vec2(3.1, 1.3) * 0.05;
    ph = -p.x * 1.7 + p.y * 3.6 + t * 1.9; g += cos(ph) * vec2(-1.7, 3.6) * 0.04;
    ph = p.x * 5.3 - p.y * 4.1 - t * 2.6;  g += cos(ph) * vec2(5.3, -4.1) * 0.022;
    ph = p.x * 8.9 + p.y * 7.7 + t * 3.3;  g += cos(ph) * vec2(8.9, 7.7) * 0.012;
    return g;
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 w = waveField(vWorld.xz);
    float dist = distance(cameraPosition, vWorld);
    // fade fine ripples with distance so they never alias into glitter
    vec2 rg = rippleGrad(vWorld.xz, uTime) * 0.55 / (1.0 + dist * 0.08);
    vec3 n = normalize(vec3(-(w.y + rg.x), 1.0, -(w.z + rg.y)));
    vec3 viewDir = normalize(cameraPosition - vWorld);

    float ndv = max(dot(n, viewDir), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

    // body colour: deeper in troughs, a touch of teal scattering on crests
    float crest = smoothstep(0.1, 0.9, vElev);
    vec3 body = mix(uDeep, uShallow, 0.45 + crest * 0.2);

    // reflected sky gradient
    vec3 r = reflect(-viewDir, n);
    float up = clamp(r.y, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(up, 0.55));
    vec3 col = mix(body, sky, fres * 0.85);

    // sun glint: tight core + soft sheen
    float sd = max(dot(r, uSunDir), 0.0);
    col += vec3(1.0, 0.95, 0.88) * pow(sd, 900.0) * 0.0;

    // tiny crest sparkles, sparse and twinkling (never blobby)
    vec2 cell = floor(vWorld.xz * 9.0);
    float h = hash(cell);
    float tw = pow(0.5 + 0.5 * sin(uTime * (2.0 + h * 3.0) + h * 40.0), 6.0);
    float sparkle = step(0.993, h) * tw * crest * uSparkle / (1.0 + dist * 0.12);
    col += uAccent * sparkle * 0.35;


    // distance haze into the sky horizon colour
    float fog = 1.0 - exp(-pow(dist * 0.026, 1.8));
    col = mix(col, uSkyHorizon, fog);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const SKY_TOP = '#020812';
export const SKY_HORIZON = '#0a2036';
export const SUN_DIR = new THREE.Vector3(-0.5, 0.62, -0.6).normalize();

export function Ocean({ amp = 0.16, caustics = 0.9, segments = 96 }: { amp?: number; caustics?: number; segments?: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: amp },
      uDeep: { value: new THREE.Color(PALETTE.deepSea) },
      uShallow: { value: new THREE.Color(PALETTE.seaMid) },
      uAccent: { value: new THREE.Color(PALETTE.accent) },
      uSkyTop: { value: new THREE.Color(SKY_TOP) },
      uSkyHorizon: { value: new THREE.Color(SKY_HORIZON) },
      uSunDir: { value: SUN_DIR.clone() },
      uSparkle: { value: caustics },
    }),
    [amp, caustics],
  );
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
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
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.45));
    // cyan horizon band — the Cognition glow on the skyline
    col += uAccent * exp(-abs(d.y) * 18.0) * 0.07;
    // soft moon/sun halo
    float s = max(dot(d, uSunDir), 0.0);
    col += vec3(0.6, 0.75, 0.95) * pow(s, 60.0) * 0.35 + vec3(0.9, 0.95, 1.0) * pow(s, 900.0) * 1.2;
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
