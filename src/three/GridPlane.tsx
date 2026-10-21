import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOARD_HALF, PALETTE } from './config';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uLine;
  uniform float uGrid;
  uniform float uScan;
  varying vec2 vUv;

  void main() {
    vec2 g = vUv * uGrid;
    // distance to the nearest cell border (g integer = border), not cell center
    vec2 d = abs(fract(g + 0.5) - 0.5);
    float fw = max(fwidth(g.x), fwidth(g.y));
    float m = min(d.x, d.y);
    float line = 1.0 - smoothstep(0.0, 0.03 + fw * 1.2, m);
    float glow = (1.0 - smoothstep(0.0, 0.16, m)) * 0.25;
    // tiny cross ticks at every intersection
    float cross = (1.0 - smoothstep(0.0, 0.05 + fw, max(d.x, d.y))) * 0.6;

    // soft radial vignette across the panel keeps the centre crisp
    vec2 c = vUv - 0.5;
    float vig = 1.0 - dot(c, c) * 0.9;

    // slow sweeping sonar band
    float sweep = fract(uTime * 0.07 * uScan);
    float band = smoothstep(0.08, 0.0, abs(vUv.y - sweep)) * 0.18 * uScan;

    float alpha = (line * 0.42 + glow * 0.7 + cross * 0.8) * vig + band * (0.4 + line);
    // faint glassy panel tint so the board reads as a distinct surface
    alpha += 0.05 * vig;
    vec3 col = uLine * (0.6 + line * 0.35 + cross * 0.6);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export function GridPlane({ color = PALETTE.accent, scan = 1 }: { color?: string; scan?: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLine: { value: new THREE.Color(color) },
      uGrid: { value: 10 },
      uScan: { value: scan },
    }),
    [color, scan],
  );
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  const size = BOARD_HALF * 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]} renderOrder={1}>
      <planeGeometry args={[size, size]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
