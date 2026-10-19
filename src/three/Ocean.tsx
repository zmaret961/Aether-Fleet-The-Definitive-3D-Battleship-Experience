import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from './config';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vElev;

  void main() {
    vec3 pos = position;
    // planeGeometry local space is XY; the mesh is rotated -PI/2 so xy -> xz
    vec2 p = pos.xy;
    float h = 0.0;
    h += sin(dot(p, normalize(vec2(1.0, 0.35))) * 0.55 + uTime * 0.9) * 0.5;
    h += sin(dot(p, normalize(vec2(-0.6, 1.0))) * 0.9 + uTime * 1.3) * 0.28;
    h += sin(dot(p, normalize(vec2(0.2, -1.0))) * 1.7 + uTime * 1.8) * 0.15;
    h += sin(dot(p, normalize(vec2(1.0, -0.8))) * 2.6 + uTime * 2.4) * 0.07;
    pos.z += h * uAmp;
    vElev = h;

    float e = 0.4;
    float hx = sin(dot(p + vec2(e, 0.0), normalize(vec2(1.0, 0.35))) * 0.55 + uTime * 0.9) * 0.5 - h * 0.5;
    float hy = sin(dot(p + vec2(0.0, e), normalize(vec2(-0.6, 1.0))) * 0.9 + uTime * 1.3) * 0.28 - h * 0.28;
    vec3 n = normalize(vec3(-hx / e, -hy / e, 1.0));
    vNormalW = n;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uAccent;
  uniform float uCaustics;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vElev;

  // Layered sine interference — cheap bounded shimmer, kept fine-grained.
  float caustic(vec2 p, float t) {
    float v = 0.0;
    v += sin(p.x * 1.9 + t * 1.1) * sin(p.y * 1.4 - t * 0.8);
    v += sin((p.x + p.y) * 2.6 - t * 1.3) * 0.6;
    v += sin(p.x * 0.8 - p.y * 1.1 + t * 0.6) * 0.4;
    return smoothstep(0.85, 1.25, v);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 lightDir = normalize(vec3(-0.35, 0.8, 0.45));

    float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);
    float elevMix = smoothstep(-0.9, 1.0, vElev);
    vec3 col = mix(uDeep, uShallow, elevMix * 0.5);

    float spec = pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), 90.0);
    col += spec * vec3(0.55, 0.8, 0.9) * 0.35;

    float ca = caustic(vWorld.xz * 1.6, uTime * 0.45);
    col += ca * uAccent * uCaustics;

    col += fres * uAccent * 0.12;

    // distance fog into the abyss
    float d = distance(cameraPosition, vWorld);
    float fog = 1.0 - exp(-d * 0.028);
    col = mix(col, uDeep, fog);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export function Ocean({ amp = 0.16, caustics = 0.22, segments = 96 }: { amp?: number; caustics?: number; segments?: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: amp },
      uDeep: { value: new THREE.Color(PALETTE.deepSea) },
      uShallow: { value: new THREE.Color(PALETTE.seaMid) },
      uAccent: { value: new THREE.Color(PALETTE.accentSoft) },
      uCaustics: { value: caustics },
    }),
    [amp, caustics],
  );
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} frustumCulled={false}>
      <planeGeometry args={[70, 70, segments, segments]} />
      <shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  );
}
