import { FLEET, GRID_SIZE, coordKey, inBounds } from './types';
import type { Coord } from './types';

/**
 * Placement priors: what the Admiral believes about where *humans* put ships.
 *
 * A uniformly random layout is the textbook assumption, but people are not
 * uniform. They space ships apart, hug (or flee) the edges, favour an
 * orientation and return to the same corners game after game. The Admiral
 * scores every candidate ship placement with a multiplicative weight built
 * from three habits, starting from a generic human model and sharpening it
 * with this player's own deployments (persisted by the store).
 */
export interface PlacementPrior {
  /** per-cell heat; a placement is weighted by the geometric mean over its cells (1 = neutral) */
  cell: number[];
  /** multiplier for placements that use / avoid the border row or column */
  edge: number;
  interior: number;
  /** multiplicative weight for horizontal / vertical placements */
  horizontal: number;
  vertical: number;
  /** multiplier per orthogonally touching pair of ships (1 = no preference) */
  touch: number;
}

/** Decayed history of one player's fleet layouts. JSON-safe for localStorage. */
export interface PlacementMemory {
  v: 1;
  /** decayed number of layouts seen */
  games: number;
  /** decayed count of ship cells per board cell (row-major, 100 entries) */
  cells: number[];
  horizontal: number;
  vertical: number;
  /** decayed count of ships using a border cell, and of ships overall */
  edgeShips: number;
  ships: number;
  /** decayed count of touching ship pairs and of ship pairs overall */
  touching: number;
  pairs: number;
}

const CELLS = GRID_SIZE * GRID_SIZE;

/** Older layouts fade so the Admiral tracks this player's current habits. */
export const MEMORY_DECAY = 0.8;

/** Share of ship pairs that touch orthogonally in a uniformly random fleet (measured, 25k layouts). */
export const RANDOM_TOUCH_RATE = 0.136;

/**
 * Generic human prior: most hand-placed fleets keep ships apart. The factor is
 * deliberately soft so an auto-deployed (random) fleet is barely penalised.
 */
export const GENERIC_TOUCH_FACTOR = 0.55;

/** Pseudo-observations that back the generic prior until history accumulates. */
export interface PriorTuning {
  cellPriorGames: number;
  cellExponent: number;
  edgePriorShips: number;
  orientationPriorShips: number;
  touchPriorPairs: number;
}

export const DEFAULT_PRIOR_TUNING: PriorTuning = {
  cellPriorGames: 3,
  cellExponent: 0.5,
  edgePriorShips: 8,
  orientationPriorShips: 6,
  touchPriorPairs: 20,
};

const onBorder = (c: Coord) => c.x === 0 || c.y === 0 || c.x === GRID_SIZE - 1 || c.y === GRID_SIZE - 1;

const neutralCells = (): number[] => Array<number>(CELLS).fill(1);

export const UNIFORM_PRIOR: PlacementPrior = Object.freeze({
  cell: neutralCells(),
  edge: 1,
  interior: 1,
  horizontal: 1,
  vertical: 1,
  touch: 1,
}) as PlacementPrior;

export const GENERIC_HUMAN_PRIOR: PlacementPrior = Object.freeze({
  cell: neutralCells(),
  edge: 1,
  interior: 1,
  horizontal: 1,
  vertical: 1,
  touch: GENERIC_TOUCH_FACTOR,
}) as PlacementPrior;

/** Expected ship-cell occupancy per cell for a uniformly random fleet. */
const baselineOccupancy = ((): number[] => {
  const out = Array<number>(CELLS).fill(0);
  for (const { length } of FLEET) {
    const counts = Array<number>(CELLS).fill(0);
    let total = 0;
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++)
        for (const horizontal of [true, false]) {
          const keys: number[] = [];
          for (let i = 0; i < length; i++) {
            const c = { x: x + (horizontal ? i : 0), y: y + (horizontal ? 0 : i) };
            if (!inBounds(c)) break;
            keys.push(coordKey(c));
          }
          if (keys.length !== length) continue;
          total++;
          for (const key of keys) counts[key]++;
        }
    for (let key = 0; key < CELLS; key++) out[key] += counts[key] / total;
  }
  return out;
})();

/** Share of a random fleet's ships that use at least one border cell. */
const baselineEdgeShare = ((): number => {
  let share = 0;
  for (const { length } of FLEET) {
    let edge = 0;
    let total = 0;
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++)
        for (const horizontal of [true, false]) {
          const cells = Array.from({ length }, (_, i) => ({ x: x + (horizontal ? i : 0), y: y + (horizontal ? 0 : i) }));
          if (!cells.every(inBounds)) continue;
          total++;
          if (cells.some(onBorder)) edge++;
        }
    share += edge / total;
  }
  return share / FLEET.length;
})();

/** Box blur (radius 2): habits are regional ("the south-west"), not cell-exact. */
const blur = (values: readonly number[]): number[] =>
  values.map((_, key) => {
    const cx = key % GRID_SIZE;
    const cy = Math.floor(key / GRID_SIZE);
    let sum = 0;
    for (let y = Math.max(0, cy - 2); y <= Math.min(GRID_SIZE - 1, cy + 2); y++)
      for (let x = Math.max(0, cx - 2); x <= Math.min(GRID_SIZE - 1, cx + 2); x++) sum += values[y * GRID_SIZE + x];
    return sum;
  });

const blurredBaseline = blur(baselineOccupancy);

export const emptyPlacementMemory = (): PlacementMemory => ({
  v: 1,
  games: 0,
  cells: Array<number>(CELLS).fill(0),
  horizontal: 0,
  vertical: 0,
  edgeShips: 0,
  ships: 0,
  touching: 0,
  pairs: 0,
});

const touches = (a: readonly Coord[], b: readonly Coord[]): boolean =>
  a.some((p) => b.some((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1));

/**
 * Pure: fold one deployed fleet (each ship as its list of cells) into memory.
 * Never mutates the input memory.
 */
export const recordPlacement = (
  memory: PlacementMemory | null | undefined,
  ships: readonly (readonly Coord[])[],
): PlacementMemory => {
  const base = memory ?? emptyPlacementMemory();
  const next: PlacementMemory = {
    v: 1,
    games: base.games * MEMORY_DECAY + 1,
    cells: base.cells.map((count) => count * MEMORY_DECAY),
    horizontal: base.horizontal * MEMORY_DECAY,
    vertical: base.vertical * MEMORY_DECAY,
    edgeShips: base.edgeShips * MEMORY_DECAY,
    ships: base.ships * MEMORY_DECAY,
    touching: base.touching * MEMORY_DECAY,
    pairs: base.pairs * MEMORY_DECAY,
  };
  const valid = ships.filter((cells) => cells.length > 0 && cells.every(inBounds));
  for (const cells of valid) {
    for (const cell of cells) next.cells[coordKey(cell)] += 1;
    next.ships += 1;
    if (cells.some(onBorder)) next.edgeShips += 1;
    if (cells.length > 1) {
      if (cells[0].y === cells[1].y) next.horizontal += 1;
      else next.vertical += 1;
    }
  }
  for (let i = 0; i < valid.length; i++)
    for (let j = i + 1; j < valid.length; j++) {
      next.pairs += 1;
      if (touches(valid[i], valid[j])) next.touching += 1;
    }
  return next;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Validate untrusted JSON (e.g. from localStorage). Returns null when unusable. */
export const parsePlacementMemory = (raw: unknown): PlacementMemory | null => {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<PlacementMemory>;
  if (m.v !== 1 || !Array.isArray(m.cells) || m.cells.length !== CELLS || !m.cells.every(finite)) return null;
  if (![m.games, m.horizontal, m.vertical, m.edgeShips, m.ships, m.touching, m.pairs].every(finite)) return null;
  return {
    v: 1,
    games: m.games!,
    cells: [...m.cells],
    horizontal: m.horizontal!,
    vertical: m.vertical!,
    edgeShips: m.edgeShips!,
    ships: m.ships!,
    touching: m.touching!,
    pairs: m.pairs!,
  };
};

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * Pure: turn a player's history into placement weights. With no history this
 * is the generic human prior; each layout shifts it toward what this player
 * actually does (including "always presses Auto-Deploy", which looks random).
 */
export const priorFromMemory = (
  memory: PlacementMemory | null | undefined,
  tuning: PriorTuning = DEFAULT_PRIOR_TUNING,
): PlacementPrior => {
  if (!memory || memory.games <= 0) return GENERIC_HUMAN_PRIOR;
  const games = memory.games;
  const heat = blur(memory.cells);
  const cell = heat.map((count, key) => {
    const base = blurredBaseline[key];
    const rate = (count + tuning.cellPriorGames * base) / (games + tuning.cellPriorGames);
    return clamp(Math.pow(rate / base, tuning.cellExponent), 0.25, 4);
  });
  const edgeShare =
    (memory.edgeShips + tuning.edgePriorShips * baselineEdgeShare) / (memory.ships + tuning.edgePriorShips);
  const ships = memory.horizontal + memory.vertical;
  const hRate = (memory.horizontal + tuning.orientationPriorShips * 0.5) / (ships + tuning.orientationPriorShips);
  const genericTouchRate = RANDOM_TOUCH_RATE * GENERIC_TOUCH_FACTOR;
  const touchRate =
    (memory.touching + tuning.touchPriorPairs * genericTouchRate) / (memory.pairs + tuning.touchPriorPairs);
  return {
    cell,
    edge: clamp(edgeShare / baselineEdgeShare, 0.2, 5),
    interior: clamp((1 - edgeShare) / (1 - baselineEdgeShare), 0.2, 5),
    horizontal: clamp(2 * hRate, 0.3, 1.7),
    vertical: clamp(2 * (1 - hRate), 0.3, 1.7),
    touch: clamp(touchRate / RANDOM_TOUCH_RATE, 0.08, 1.4),
  };
};

/**
 * One-line read on the player's habits for taunts ("I've read your commits"),
 * or null until there is enough history to say something true.
 */
export const placementTell = (memory: PlacementMemory | null | undefined): string | null => {
  if (!memory || memory.games < 1.8) return null;
  const ships = memory.horizontal + memory.vertical;
  if (ships > 0) {
    const h = memory.horizontal / ships;
    if (h >= 0.8) return 'You always deploy horizontally. Predictable diff.';
    if (h <= 0.2) return 'Vertical hulls again? I read your git blame.';
  }
  if (memory.pairs > 0 && memory.touching / memory.pairs < 0.03) return 'You never let your ships touch. Lonely architecture.';
  let edge = 0;
  let total = 0;
  memory.cells.forEach((count, key) => {
    total += count;
    const x = key % GRID_SIZE;
    const y = Math.floor(key / GRID_SIZE);
    if (x === 0 || y === 0 || x === GRID_SIZE - 1 || y === GRID_SIZE - 1) edge += count;
  });
  if (total > 0) {
    if (edge / total > 0.45) return 'Hugging the edges again. I patched that exploit in 1987.';
    if (edge / total < 0.1) return 'Everything in the middle. Monoliths love a monolith.';
  }
  const half = GRID_SIZE / 2;
  const quadrants = [0, 0, 0, 0];
  memory.cells.forEach((count, key) => {
    const x = key % GRID_SIZE;
    const y = Math.floor(key / GRID_SIZE);
    quadrants[(y < half ? 0 : 2) + (x < half ? 0 : 1)] += count;
  });
  const top = Math.max(...quadrants);
  if (total > 0 && top / total > 0.45) {
    const names = ['north-west', 'north-east', 'south-west', 'south-east'];
    return `Your fleet keeps camping the ${names[quadrants.indexOf(top)]} sector. Cached.`;
  }
  return null;
};
