import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GRID_SIZE } from '../game/types';
import type { CellMark } from '../game/types';
import { cellToWorld, PALETTE } from './config';

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

/**
 * Hit/miss markers for a whole board rendered as two instanced meshes —
 * ~2 draw calls regardless of how many cells have been fired upon.
 */
export function MarkerField({ marks, version }: { marks: CellMark[][]; version: number }) {
  const missRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const hitMat = useRef<THREE.MeshStandardMaterial>(null);

  const { missCells, hitCells } = useMemo(() => {
    const missCells: [number, number][] = [];
    const hitCells: [number, number][] = [];
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++) {
        if (marks[y][x] === 'miss') missCells.push(cellToWorld({ x, y }));
        else if (marks[y][x] === 'hit') hitCells.push(cellToWorld({ x, y }));
      }
    return { missCells, hitCells };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, version]);

  useEffect(() => {
    const m = missRef.current;
    if (m) {
      missCells.forEach(([x, z], i) => {
        tmp.position.set(x, 0.06, z);
        tmp.rotation.set(-Math.PI / 2, 0, 0);
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        m.setColorAt(i, tmpColor.set(PALETTE.miss));
      });
      m.count = missCells.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    const h = hitRef.current;
    if (h) {
      hitCells.forEach(([x, z], i) => {
        tmp.position.set(x, 0.07, z);
        tmp.rotation.set(-Math.PI / 2, 0, 0);
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        h.setMatrixAt(i, tmp.matrix);
      });
      h.count = hitCells.length;
      h.instanceMatrix.needsUpdate = true;
    }
  }, [missCells, hitCells]);

  useFrame(() => {
    if (hitMat.current) {
      const t = performance.now() / 1000;
      hitMat.current.emissiveIntensity = 1.6 + Math.sin(t * 5) * 0.5;
    }
  });

  return (
    <group>
      <instancedMesh ref={missRef} args={[undefined, undefined, 100]} frustumCulled={false}>
        <ringGeometry args={[0.16, 0.3, 20]} />
        <meshStandardMaterial color={PALETTE.miss} transparent opacity={0.55} roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={hitRef} args={[undefined, undefined, 100]} frustumCulled={false}>
        <circleGeometry args={[0.3, 8]} />
        <meshStandardMaterial
          ref={hitMat}
          color={PALETTE.hit}
          emissive={PALETTE.hitHot}
          emissiveIntensity={1.6}
          transparent
          opacity={0.9}
        />
      </instancedMesh>
    </group>
  );
}
