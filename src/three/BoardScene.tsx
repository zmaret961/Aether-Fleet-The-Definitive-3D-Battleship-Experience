import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Board } from '../game/board';
import { GRID_SIZE, shipSpec } from '../game/types';
import type { Coord } from '../game/types';
import { shipCellsFor, canPlace } from '../game/board';
import { useGame } from '../state/store';
import { BOARD_HALF, cellToWorld, PALETTE, worldToCell } from './config';
import { GridPlane } from './GridPlane';
import { MarkerField } from './Markers';
import { ShipMesh } from './ShipMesh';
import { EffectsLayer } from './Effects';

function Frame() {
  const s = BOARD_HALF + 0.18;
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.accentSoft,
        emissive: PALETTE.accentSoft,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.8,
      }),
    [],
  );
  return (
    <group>
      {[
        [0, -s, BOARD_HALF * 2 + 0.4, 0.06],
        [0, s, BOARD_HALF * 2 + 0.4, 0.06],
        [-s, 0, 0.06, BOARD_HALF * 2 + 0.4],
        [s, 0, 0.06, BOARD_HALF * 2 + 0.4],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.1, z]} material={mat}>
          <boxGeometry args={[w, 0.05, d]} />
        </mesh>
      ))}
    </group>
  );
}

/** Pulsing targeting reticle for a single cell. */
function Reticle({ coord, locked }: { coord: Coord; locked: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const t = performance.now() / 1000;
    const s = locked ? 0.92 : 0.82 + Math.sin(t * 4) * 0.05;
    ref.current.scale.setScalar(s);
    ref.current.rotation.y = t * (locked ? 1.4 : 0.4);
  });
  const [x, z] = cellToWorld(coord);
  const color = locked ? PALETTE.hit : PALETTE.accent;
  return (
    <group ref={ref} position={[x, 0.1, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.4, 4]} />
        <meshBasicMaterial color={color} transparent opacity={locked ? 0.95 : 0.7} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <ringGeometry args={[0.14, 0.18, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Green/red cell coverage preview while deploying. */
function GhostCells({ cells, valid }: { cells: Coord[]; valid: boolean }) {
  return (
    <group>
      {cells.map((c, i) => {
        const [x, z] = cellToWorld(c);
        return (
          <mesh key={i} position={[x, 0.065, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.9, 0.9]} />
            <meshBasicMaterial
              color={valid ? PALETTE.accent : PALETTE.enemy}
              transparent
              opacity={0.3}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export function BoardScene() {
  const phase = useGame((s) => s.phase);
  const boardView = useGame((s) => s.boardView);
  const match = useGame((s) => s.match);
  const matchVersion = useGame((s) => s.matchVersion);
  const deploy = useGame((s) => s.deploy);
  const target = useGame((s) => s.target);
  const turnLock = useGame((s) => s.turnLock);
  const aimAt = useGame((s) => s.aimAt);
  const tryPlace = useGame((s) => s.tryPlace);
  const pickupShip = useGame((s) => s.pickupShip);
  const aiThinking = useGame((s) => s.aiThinking);

  const [hover, setHover] = useState<Coord | null>(null);
  const hoverRef = useRef<Coord | null>(null);

  // The board the camera is currently looking at.
  const shownBoard: Board = phase === 'deploy' ? deploy.board : match ? (boardView === 'enemy' ? match.enemy : match.player) : deploy.board;
  const shownMarks = phase === 'deploy' ? deploy.board.marks : match ? shownBoard.marks : deploy.board.marks;

  const interactive =
    (phase === 'deploy' && !!deploy.selected) || (phase === 'battle' && boardView === 'enemy' && !turnLock && !aiThinking);

  const ghost = useMemo(() => {
    if (phase !== 'deploy' || !deploy.selected || !hover) return null;
    const spec = shipSpec(deploy.selected);
    const cells = shipCellsFor(hover, deploy.orientation, spec.length);
    return { cells, valid: cells.every((c) => c.x < GRID_SIZE && c.y < GRID_SIZE) && canPlace(deploy.board, hover, deploy.orientation, spec.length) };
  }, [phase, deploy.selected, deploy.orientation, deploy.board, hover]);

  return (
    <group>
      <GridPlane />
      <Frame />
      <MarkerField marks={shownMarks} version={matchVersion} />

      {/* ships */}
      {phase === 'deploy' &&
        deploy.board.ships.map((s) => (
          <group
            key={s.spec.id}
            onClick={(e) => {
              e.stopPropagation();
              pickupShip(s.spec.id);
            }}
          >
            <ShipMesh ship={s} />
          </group>
        ))}
      {phase === 'battle' &&
        match &&
        shownBoard.ships
          .filter((s) => boardView === 'player' || s.sunk)
          .map((s) => <ShipMesh key={s.spec.id} ship={s} />)}
      {phase === 'over' &&
        match &&
        shownBoard.ships.map((s) => <ShipMesh key={s.spec.id} ship={s} />)}

      {ghost && <GhostCells cells={ghost.cells} valid={ghost.valid} />}

      {phase === 'battle' && boardView === 'enemy' && hover && !target && !turnLock && (
        <Reticle coord={hover} locked={false} />
      )}
      {phase === 'battle' && boardView === 'enemy' && target && <Reticle coord={target} locked />}

      <EffectsLayer />

      {/* invisible pick plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.04, 0]}
        onPointerMove={(e) => {
          if (!interactive) return;
          const c = worldToCell(e.point.x, e.point.z);
          if (!c) return;
          if (!hoverRef.current || hoverRef.current.x !== c.x || hoverRef.current.y !== c.y) {
            hoverRef.current = c;
            setHover(c);
          }
        }}
        onPointerOut={() => {
          hoverRef.current = null;
          setHover(null);
        }}
        onClick={(e) => {
          if (!interactive) return;
          const c = worldToCell(e.point.x, e.point.z);
          if (!c) return;
          if (phase === 'deploy') tryPlace(c);
          else aimAt(c);
        }}
      >
        <planeGeometry args={[BOARD_HALF * 2, BOARD_HALF * 2]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
