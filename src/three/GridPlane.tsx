import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOARD_HALF, PALETTE } from './config';

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uLine;
  uniform float uGrid;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec2 g = vUv * uGrid;
    vec2 d = abs(fract(g) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.06, min(d.x, d.y));
    float pulse = 0.75 + 0.25 * sin(uTime * 0.8 + (vUv.x + vUv.y) * 6.2831);
    float edge = smoothstep(0.5, 0.42, distance(vUv, vec2(0.5)));
    float alpha = line * 0.34 * pulse * edge;
    // faint panel tint so the board reads as a distinct surface
    alpha += 0.045 * edge;
    gl_FragColor = vec4(uLine, alpha);
  }
`;

export function GridPlane() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLine: { value: new THREE.Color(PALETTE.accent) },
      uGrid: { value: 10 },
    }),
    [],
  );
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  const size = BOARD_HALF * 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]}>
      <planeGeometry args={[size, size]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
