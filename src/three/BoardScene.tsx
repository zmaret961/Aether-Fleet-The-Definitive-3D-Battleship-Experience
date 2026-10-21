import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Board } from '../game/board';
import { GRID_SIZE, shipSpec } from '../game/types';
import type { Coord } from '../game/types';
import { shipCellsFor, canPlace } from '../game/board';
import { useGame } from '../state/store';
import {
  BOARD_HALF,
  cellToWorld,
  ENEMY_BOARD_POS,
  LEGACY_MONOLITH_POSITION,
  LEGACY_MONOLITH_SCALE,
  PALETTE,
  PLAYER_BOARD_POS,
  worldToCell,
} from './config';
import { GridPlane } from './GridPlane';
import { MarkerField } from './Markers';
import { ShipMesh } from './ShipMesh';
import { LegacyMonolith } from './LegacyMonolith';

const RIM_MAT = new THREE.MeshStandardMaterial({ color: '#1a2a3a', metalness: 0.5, roughness: 0.35 });

function makeLabelTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.font = '700 84px "Inter Variable", Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.fillStyle = color;
    g.fillText(text, 64, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A1–J10 coordinate labels along the top and left rims. */
function CoordLabels({ color }: { color: string }) {
  const labels = useMemo(() => {
    const out: { key: string; pos: [number, number, number]; tex: THREE.Texture }[] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      const [x, z] = cellToWorld({ x: i, y: i });
      out.push({ key: `c${i}`, pos: [x, 0.08, -BOARD_HALF - 0.62], tex: makeLabelTexture(String.fromCharCode(65 + i), color) });
      out.push({ key: `r${i}`, pos: [-BOARD_HALF - 0.62, 0.08, z], tex: makeLabelTexture(String(i + 1), color) });
    }
    return out;
  }, [color]);
  return (
    <group>
      {labels.map((l) => (
        <mesh key={l.key} position={l.pos} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <planeGeometry args={[0.62, 0.62]} />
          <meshBasicMaterial map={l.tex} transparent opacity={1} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Beveled gunmetal bezel with an inner light strip and glowing corner brackets. */
function Frame({ color }: { color: string }) {
  const s = BOARD_HALF + 0.16;
  const full = BOARD_HALF * 2 + 0.44;
  const glow = useMemo(
    () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, toneMapped: false }),
    [color],
  );
  const bracket = 1.1;
  return (
    <group>
      {[
        [0, -s, full, 0.22],
        [0, s, full, 0.22],
        [-s, 0, 0.22, full],
        [s, 0, 0.22, full],
      ].map(([x, z, w, d], i) => (
        <group key={i}>
          <mesh position={[x, 0.04, z]} material={RIM_MAT} castShadow receiveShadow>
            <boxGeometry args={[w, 0.14, d]} />
          </mesh>
          <mesh position={[x, 0.115, z]} material={glow}>
            <boxGeometry args={[w === 0.22 ? 0.035 : w - 0.1, 0.012, d === 0.22 ? 0.035 : d - 0.1]} />
          </mesh>
        </group>
      ))}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <group key={i} position={[sx * (s + 0.06), 0.13, sz * (s + 0.06)]}>
          <mesh position={[(-sx * bracket) / 2, 0, 0]} material={glow}>
            <boxGeometry args={[bracket, 0.03, 0.08]} />
          </mesh>
          <mesh position={[0, 0, (-sz * bracket) / 2]} material={glow}>
            <boxGeometry args={[0.08, 0.03, bracket]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const PANEL_MAT = new THREE.MeshStandardMaterial({
  color: '#071624',
  metalness: 0.2,
  roughness: 0.3,
  transparent: true,
  opacity: 0.78,
  depthWrite: false,
});

/** Smoked-glass deck under the grid (calms the water behind the lines) plus
 * a shadow catcher so ships ground onto the board. */
function BoardPanel() {
  const size = BOARD_HALF * 2 + 0.2;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} material={PANEL_MAT} renderOrder={0}>
        <planeGeometry args={[size, size]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} receiveShadow renderOrder={0}>
        <planeGeometry args={[size, size]} />
        <shadowMaterial transparent opacity={0.45} depthWrite={false} />
      </mesh>
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

/** One full board surface at a world offset — grid, frame, markers, ships,
 * optional pick plane. All contents use local cell coords inside the group. */
function BoardGroup({
  position,
  board,
  version,
  side,
}: {
  position: [number, number, number];
  board: Board;
  version: number;
  side: 'player' | 'enemy';
}) {
  const phase = useGame((s) => s.phase);
  const deploy = useGame((s) => s.deploy);
  const target = useGame((s) => s.target);
  const turnLock = useGame((s) => s.turnLock);
  const aimAt = useGame((s) => s.aimAt);
  const tryPlace = useGame((s) => s.tryPlace);
  const pickupShip = useGame((s) => s.pickupShip);
  const aiThinking = useGame((s) => s.aiThinking);

  const [hover, setHover] = useState<Coord | null>(null);
  const hoverRef = useRef<Coord | null>(null);

  const interactive =
    side === 'enemy'
      ? phase === 'battle' && !turnLock && !aiThinking
      : phase === 'deploy' && !!deploy.selected;

  const ghost = useMemo(() => {
    if (side !== 'player' || phase !== 'deploy' || !deploy.selected || !hover) return null;
    const spec = shipSpec(deploy.selected);
    const cells = shipCellsFor(hover, deploy.orientation, spec.length);
    return { cells, valid: cells.every((c) => c.x < GRID_SIZE && c.y < GRID_SIZE) && canPlace(deploy.board, hover, deploy.orientation, spec.length) };
  }, [side, phase, deploy.selected, deploy.orientation, deploy.board, hover]);

  // enemy waters glow a hostile rose during battle so the two boards never blur together
  const tint = side === 'enemy' ? PALETTE.enemy : PALETTE.accent;

  const showShips =
    side === 'player' || phase === 'over'
      ? board.ships
      : board.ships.filter((s) => s.sunk);

  return (
    <group position={position}>
      <BoardPanel />
      <GridPlane color={tint} scan={side === 'enemy' ? 1 : 0.6} />
      <Frame color={tint} />
      <CoordLabels color={tint} />
      <MarkerField marks={board.marks} version={version} />

      {showShips.map((s) =>
        side === 'player' && phase === 'deploy' ? (
          <group key={s.spec.id} onClick={(e) => { e.stopPropagation(); pickupShip(s.spec.id); }}>
            <ShipMesh ship={s} side={side} />
          </group>
        ) : (
          <ShipMesh key={s.spec.id} ship={s} side={side} />
        ),
      )}

      {ghost && <GhostCells cells={ghost.cells} valid={ghost.valid} />}

      {side === 'enemy' && phase === 'battle' && hover && !target && !turnLock && (
        <Reticle coord={hover} locked={false} />
      )}
      {side === 'enemy' && phase === 'battle' && target && <Reticle coord={target} locked />}

      {/* invisible pick plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.04, 0]}
        onPointerMove={(e) => {
          if (!interactive) return;
          const c = worldToCell(e.point.x - position[0], e.point.z - position[2]);
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
          const c = worldToCell(e.point.x - position[0], e.point.z - position[2]);
          if (!c) return;
          if (side === 'enemy') aimAt(c);
          else tryPlace(c);
        }}
      >
        <planeGeometry args={[BOARD_HALF * 2, BOARD_HALF * 2]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

export function BoardScene() {
  const phase = useGame((s) => s.phase);
  const match = useGame((s) => s.match);
  const matchVersion = useGame((s) => s.matchVersion);
  const deploy = useGame((s) => s.deploy);

  const battle = (phase === 'battle' || phase === 'over') && match;

  return (
    <group>
      {battle ? (
        <>
          {/* Battleship "laptop": your fleet in front, enemy waters behind */}
          <BoardGroup position={PLAYER_BOARD_POS} board={match.player} version={matchVersion} side="player" />
          <BoardGroup position={ENEMY_BOARD_POS} board={match.enemy} version={matchVersion} side="enemy" />
          <LegacyMonolith position={LEGACY_MONOLITH_POSITION} scale={LEGACY_MONOLITH_SCALE} />
        </>
      ) : (
        <BoardGroup position={[0, 0, 0]} board={deploy.board} version={matchVersion} side="player" />
      )}
    </group>
  );
}
