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
    vec2 fw = max(fwidth(g), vec2(1e-4));
    // hairline: ~1px anti-aliased line in screen space, whatever the zoom
    vec2 px = d / fw;
    float line = 1.0 - smoothstep(0.35, 1.25, min(px.x, px.y));
    // small "+" ticks at intersections give the plotting-table read
    float tick = (1.0 - smoothstep(0.0, 0.07, max(d.x, d.y))) * (1.0 - smoothstep(0.6, 1.6, min(px.x, px.y)));

    vec2 c = vUv - 0.5;
    float vig = 1.0 - dot(c, c) * 1.1;

    // slow sonar sweep: a thin bright leading edge with a short fading tail
    float sweep = fract(uTime * 0.06 * uScan);
    float dy = sweep - vUv.y;
    float band = (smoothstep(0.0, 0.004, dy) * (1.0 - smoothstep(0.0, 0.12, dy))) * 0.1 * uScan;

    float alpha = line * 0.5 * vig + tick * 0.55 + band * (0.35 + line * 1.5);
    // faint glassy tint so the board reads as a surface
    alpha += 0.035 * vig;
    // stays below the bloom threshold: crisp lines, no Tron haze
    vec3 col = uLine * (0.55 + tick * 0.25 + band);
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
