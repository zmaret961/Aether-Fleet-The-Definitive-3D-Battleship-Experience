import { allPlacements, createBoard } from './board';
import type { Board } from './board';
import { FLEET, GRID_SIZE } from './types';
import type { Coord, Rng } from './types';

/**
 * A simulated human deployer, used to benchmark the AI against layouts that
 * look hand-placed rather than uniformly random. These are modelled habits,
 * not measured data: spacing ships apart, edge preference or avoidance,
 * orientation bias and a favourite sector of the board.
 */
export interface HumanStyle {
  name: string;
  /** weight multiplier for a placement that uses any border cell */
  edge: number;
  /** probability a placement touching another ship orthogonally is rejected */
  avoidTouch: number;
  /** probability a diagonal-only contact is rejected */
  avoidDiagonal: number;
  /** probability a ship is placed horizontally */
  horizontal: number;
  /** optional favourite sector: weight multiplier per cell near it */
  hotspot?: { x: number; y: number; strength: number };
}

export const HUMAN_ARCHETYPES: readonly HumanStyle[] = [
  { name: 'spreader', edge: 0.55, avoidTouch: 0.92, avoidDiagonal: 0.6, horizontal: 0.5 },
  { name: 'edge-hugger', edge: 3.2, avoidTouch: 0.85, avoidDiagonal: 0.3, horizontal: 0.5 },
  { name: 'sector-camper', edge: 1, avoidTouch: 0.4, avoidDiagonal: 0, horizontal: 0.5, hotspot: { x: 2, y: 2, strength: 2.2 } },
  { name: 'auto-deployer', edge: 1, avoidTouch: 0, avoidDiagonal: 0, horizontal: 0.5 },
];

/** Archetype mix: most players space ships; some just press Auto-Deploy. */
const ARCHETYPE_WEIGHTS = [0.45, 0.25, 0.15, 0.15];

/** A persistent persona: an archetype plus personal quirks that repeat game to game. */
export const randomHumanStyle = (rng: Rng): HumanStyle => {
  let roll = rng();
  let index = 0;
  while (index < ARCHETYPE_WEIGHTS.length - 1 && roll >= ARCHETYPE_WEIGHTS[index]) {
    roll -= ARCHETYPE_WEIGHTS[index];
    index++;
  }
  const archetype = HUMAN_ARCHETYPES[index];
  if (archetype.name === 'auto-deployer') return archetype;
  const tilt = rng();
  return {
    ...archetype,
    horizontal: tilt < 0.3 ? 0.78 : tilt < 0.6 ? 0.22 : 0.5,
    hotspot: archetype.hotspot
      ? {
          x: Math.floor(rng() * GRID_SIZE),
          y: Math.floor(rng() * GRID_SIZE),
          strength: archetype.hotspot.strength,
        }
      : undefined,
  };
};

const onEdge = (c: Coord) => c.x === 0 || c.y === 0 || c.x === GRID_SIZE - 1 || c.y === GRID_SIZE - 1;

/** Hand-placed fleet following `style`. Ships are placed largest first, like most people do. */
export const humanLikeLayout = (rng: Rng, style: HumanStyle = HUMAN_ARCHETYPES[0]): Board => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const board = createBoard();
    let failed = false;
    for (const spec of [...FLEET].sort((a, b) => b.length - a.length)) {
      const options = allPlacements(board.shipAt, spec.length).map((placement) => {
        let weight = placement.orientation === 'h' ? style.horizontal : 1 - style.horizontal;
        if (placement.cells.some(onEdge)) weight *= style.edge;
        if (style.hotspot) {
          const { x, y, strength } = style.hotspot;
          const near = placement.cells.filter((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= 3).length;
          weight *= Math.pow(strength, near / placement.cells.length);
        }
        let orthogonal = false;
        let diagonal = false;
        for (const c of placement.cells) {
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const n = { x: c.x + dx, y: c.y + dy };
              if (n.x < 0 || n.y < 0 || n.x >= GRID_SIZE || n.y >= GRID_SIZE) continue;
              if (board.shipAt[n.y][n.x] === null) continue;
              if (dx === 0 || dy === 0) orthogonal = true;
              else diagonal = true;
            }
        }
        if (orthogonal) weight *= 1 - style.avoidTouch;
        else if (diagonal) weight *= 1 - style.avoidDiagonal;
        return { placement, weight };
      });
      const total = options.reduce((sum, option) => sum + option.weight, 0);
      if (total <= 0) {
        failed = true;
        break;
      }
      let roll = rng() * total;
      let pick = options[options.length - 1].placement;
      for (const option of options) {
        roll -= option.weight;
        if (roll < 0) {
          pick = option.placement;
          break;
        }
      }
      board.ships.push({ spec, cells: pick.cells, hits: 0, sunk: false });
      for (const c of pick.cells) board.shipAt[c.y][c.x] = spec.id;
    }
    if (!failed) return board;
  }
  throw new Error('Unable to generate a human-like layout');
};
