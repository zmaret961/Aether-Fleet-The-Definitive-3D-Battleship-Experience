import { GRID_SIZE, ORTHOGONAL, coordKey, inBounds, keyToCoord } from './types';
import type { Coord, Orientation, Rng } from './types';
import { shipCellsFor } from './board';
import { priorFromMemory } from './prior';
import type { PlacementMemory, PlacementPrior } from './prior';

export type Difficulty = 'cadet' | 'officer' | 'commander' | 'admiral';

export const DIFFICULTY_INFO: Record<
  Difficulty,
  {
    label: string;
    tagline: string;
    description: string;
    rank: 1 | 2 | 3 | 4;
    doctrine: string;
    /** mean shots to sink a uniformly random fleet (opt-in AI_BENCH, 200 games) */
    avgShots: number;
    /** mean shots vs human-like layouts on first meeting, and vs a returning player (games 4+) */
    vsHuman: number;
    vsReturning: number;
  }
> = {
  cadet: {
    label: 'Flaky Test',
    tagline: 'Mostly green',
    description: 'Only fails when someone important is watching.',
    rank: 1,
    doctrine: 'Fires at random. Chases a hit about a third of the time — when it remembers.',
    avgShots: 74,
    vsHuman: 77,
    vsReturning: 77,
  },
  officer: {
    label: 'Merge Conflict',
    tagline: 'Nobody owns this branch',
    description: 'Can resolve anything except its own rebase.',
    rank: 2,
    doctrine: 'Textbook hunt/target: checkerboard sweeps, then walks the line once it lands a hit.',
    avgShots: 50,
    vsHuman: 52,
    vsReturning: 52,
  },
  commander: {
    label: 'CVE Backlog',
    tagline: 'CVSS 10.0 personality',
    description: 'Prioritizes every risk. Patches absolutely nothing.',
    rank: 3,
    doctrine: 'Builds a probability heatmap of every legal ship placement and fires at the hottest cell.',
    avgShots: 45,
    vsHuman: 45,
    vsReturning: 45,
  },
  admiral: {
    label: 'The Legacy Monolith',
    tagline: 'Last touched in 1987',
    description: 'Compiles at dawn. Nobody knows why it works.',
    rank: 4,
    doctrine:
      'Solves the exact posterior over every fleet still consistent with your board, models how humans deploy, and remembers how you deployed last time.',
    avgShots: 44,
    vsHuman: 44,
    vsReturning: 41,
  },
};

/** Everything an AI may legally know about the player's board. */
export interface AIView {
  /** 'unknown' | 'miss' | 'hit' per cell */
  marks: ('unknown' | 'miss' | 'hit')[][];
  /** cells confirmed to belong to sunk ships (announced on sink) */
  sunkCells: boolean[][];
  /** lengths of the player's ships still afloat */
  remainingLengths: number[];
}

export interface AIPlayer {
  next(view: AIView): Coord;
  /** why the last shot was chosen (Admiral only) */
  readonly lastDecision?: AIDecision | null;
}

interface Placement {
  cells: Coord[];
  keys: number[];
  /** in-bounds orthogonal neighbours outside the ship */
  neighbours: number[];
  horizontal: boolean;
}

const placementCache = new Map<number, Placement[]>();
const cellPlacementCache = new Map<number, Placement[][]>();

const placementsFor = (length: number): Placement[] => {
  const cached = placementCache.get(length);
  if (cached) return cached;
  const placements: Placement[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (const orientation of ['h', 'v'] as Orientation[]) {
        const cells = shipCellsFor({ x, y }, orientation, length);
        if (!cells.every(inBounds)) continue;
        const keys = cells.map(coordKey);
        const neighbours = new Set<number>();
        for (const cell of cells)
          for (const delta of ORTHOGONAL) {
            const n = { x: cell.x + delta.x, y: cell.y + delta.y };
            if (inBounds(n) && !keys.includes(coordKey(n))) neighbours.add(coordKey(n));
          }
        placements.push({ cells, keys, neighbours: [...neighbours], horizontal: orientation === 'h' });
      }
    }
  }
  placementCache.set(length, placements);
  return placements;
};

const placementsByCell = (length: number): Placement[][] => {
  const cached = cellPlacementCache.get(length);
  if (cached) return cached;
  const byCell = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => [] as Placement[]);
  for (const placement of placementsFor(length)) {
    for (const key of placement.keys) byCell[key].push(placement);
  }
  cellPlacementCache.set(length, byCell);
  return byCell;
};

const untriedKeys = (view: AIView): number[] => {
  const out: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++)
    for (let x = 0; x < GRID_SIZE; x++)
      if (view.marks[y][x] === 'unknown') out.push(coordKey({ x, y }));
  return out;
};

const requireUntried = (view: AIView): number[] => {
  const keys = untriedKeys(view);
  if (keys.length === 0) throw new Error('No legal shots remain');
  return keys;
};

const unsunkHitKeys = (view: AIView): number[] => {
  const out: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++)
    for (let x = 0; x < GRID_SIZE; x++)
      if (view.marks[y][x] === 'hit' && !view.sunkCells[y][x]) out.push(coordKey({ x, y }));
  return out;
};

/** Legal placements for a ship of `length` given what the AI knows. */
function* legalPlacements(view: AIView, length: number): Generator<Placement> {
  for (const placement of placementsFor(length)) {
    if (
      placement.cells.every(
        (cell) => view.marks[cell.y][cell.x] !== 'miss' && !view.sunkCells[cell.y][cell.x],
      )
    ) {
      yield placement;
    }
  }
}

/** Analytic count of legal placements touching each cell. */
const densityMap = (view: AIView, hitPower: number): number[][] => {
  const map = Array.from({ length: GRID_SIZE }, () => Array<number>(GRID_SIZE).fill(0));
  const targetMode = unsunkHitKeys(view).length > 0;
  for (const length of view.remainingLengths) {
    for (const placement of legalPlacements(view, length)) {
      let hitsCovered = 0;
      for (const cell of placement.cells) {
        if (view.marks[cell.y][cell.x] === 'hit' && !view.sunkCells[cell.y][cell.x]) hitsCovered++;
      }
      if (targetMode && hitsCovered === 0) continue;
      const weight = targetMode ? Math.pow(hitsCovered, hitPower) : 1;
      for (const cell of placement.cells) map[cell.y][cell.x] += weight;
    }
  }
  return map;
};

const chooseRandom = <T>(items: T[], rng: Rng): T =>
  items[Math.floor(rng() * items.length)];

const chooseByDensity = (map: number[][], view: AIView, rng: Rng): Coord => {
  let best = -1;
  const keys: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (view.marks[y][x] !== 'unknown') continue;
      const value = map[y][x];
      if (value > best) {
        best = value;
        keys.length = 0;
        keys.push(coordKey({ x, y }));
      } else if (value === best && value > 0) {
        keys.push(coordKey({ x, y }));
      }
    }
  }
  if (keys.length === 0) return keyToCoord(chooseRandom(requireUntried(view), rng));
  return keyToCoord(chooseRandom(keys, rng));
};

interface FleetSample {
  occupiedKeys: number[];
  weight: number;
}

interface TargetCandidate {
  shipIndex: number;
  placement: Placement;
}

const sampleFleet = (
  rng: Rng,
  importanceWeighting: boolean,
  blocked: boolean[],
  hitKeys: number[],
  hitMask: boolean[],
  candidatesByHit: Map<number, TargetCandidate[]>,
  placementOrder: { length: number; index: number }[],
  scratch: {
    occupied: boolean[];
    occupiedKeys: number[];
    unplaced: boolean[];
    covered: boolean[];
    candidates: TargetCandidate[];
  },
): FleetSample | null => {
  const { occupied, occupiedKeys, unplaced, covered, candidates: candidateBuffer } = scratch;
  occupied.fill(false);
  occupiedKeys.length = 0;
  unplaced.fill(true);
  covered.fill(false);
  candidateBuffer.length = 0;
  let coveredCount = 0;
  let weight = 1;

  while (coveredCount < hitKeys.length) {
    const focus = hitKeys.find((key) => !covered[key]);
    if (focus === undefined) break;
    candidateBuffer.length = 0;
    for (const candidate of candidatesByHit.get(focus) ?? []) {
      if (!unplaced[candidate.shipIndex]) continue;
      let legal = true;
      for (const key of candidate.placement.keys) {
        if (blocked[key] || occupied[key]) {
          legal = false;
          break;
        }
      }
      if (legal) candidateBuffer.push(candidate);
    }
    if (candidateBuffer.length === 0) return null;
    const selected = chooseRandom(candidateBuffer, rng);
    if (importanceWeighting) weight *= candidateBuffer.length;
    for (const key of selected.placement.keys) {
      occupied[key] = true;
      occupiedKeys.push(key);
      if (hitMask[key] && !covered[key]) {
        covered[key] = true;
        coveredCount++;
      }
    }
    unplaced[selected.shipIndex] = false;
  }

  for (const ship of placementOrder) {
    if (!unplaced[ship.index]) continue;
    let placed = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const origin = { x: Math.floor(rng() * GRID_SIZE), y: Math.floor(rng() * GRID_SIZE) };
      const orientation: Orientation = rng() < 0.5 ? 'h' : 'v';
      let legal = true;
      for (let i = 0; i < ship.length; i++) {
        const x = origin.x + (orientation === 'h' ? i : 0);
        const y = origin.y + (orientation === 'v' ? i : 0);
        if (x >= GRID_SIZE || y >= GRID_SIZE || blocked[y * GRID_SIZE + x] || occupied[y * GRID_SIZE + x]) {
          legal = false;
          break;
        }
      }
      if (!legal) continue;
      for (let i = 0; i < ship.length; i++) {
        const x = origin.x + (orientation === 'h' ? i : 0);
        const y = origin.y + (orientation === 'v' ? i : 0);
        const key = y * GRID_SIZE + x;
        occupied[key] = true;
        occupiedKeys.push(key);
      }
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  return { occupiedKeys, weight };
};

const monteCarloMap = (
  view: AIView,
  rng: Rng,
  samples: number,
  importanceWeighting: boolean,
): number[][] => {
  const map = Array.from({ length: GRID_SIZE }, () => Array<number>(GRID_SIZE).fill(0));
  const blocked = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, key) => {
    const { x, y } = keyToCoord(key);
    return view.marks[y][x] === 'miss' || view.sunkCells[y][x];
  });
  const hitKeys = unsunkHitKeys(view);
  const hitMask = Array<boolean>(GRID_SIZE * GRID_SIZE).fill(false);
  const placementOrder = view.remainingLengths
    .map((length, index) => ({ length, index }))
    .sort((a, b) => b.length - a.length || a.index - b.index);
  const scratch = {
    occupied: Array<boolean>(GRID_SIZE * GRID_SIZE).fill(false),
    occupiedKeys: [] as number[],
    unplaced: Array<boolean>(view.remainingLengths.length).fill(true),
    covered: Array<boolean>(GRID_SIZE * GRID_SIZE).fill(false),
    candidates: [] as TargetCandidate[],
  };
  const candidatesByHit = new Map<number, TargetCandidate[]>();
  for (const hit of hitKeys) hitMask[hit] = true;
  for (const hit of hitKeys) {
    const candidates: TargetCandidate[] = [];
    view.remainingLengths.forEach((length, shipIndex) => {
      for (const placement of placementsByCell(length)[hit]) {
        candidates.push({ shipIndex, placement });
      }
    });
    candidatesByHit.set(hit, candidates);
  }
  for (let sample = 0; sample < samples; sample++) {
    const fleet = sampleFleet(
      rng,
      importanceWeighting,
      blocked,
      hitKeys,
      hitMask,
      candidatesByHit,
      placementOrder,
      scratch,
    );
    if (!fleet) continue;
    for (const key of fleet.occupiedKeys) {
      const x = key % GRID_SIZE;
      const y = Math.floor(key / GRID_SIZE);
      if (view.marks[y][x] === 'unknown') map[y][x] += fleet.weight;
    }
  }
  return map;
};

// ---------------------------------------------------------------------------
// Cadet — random fire with a short memory for the latest hit.
// ---------------------------------------------------------------------------
class CadetAI implements AIPlayer {
  private previousMarks: ('unknown' | 'miss' | 'hit')[][] | null = null;
  private lastHitKey: number | null = null;

  constructor(private rng: Rng) {}

  next(view: AIView): Coord {
    const unknown = requireUntried(view);
    if (this.previousMarks) {
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          if (view.marks[y][x] === 'hit' && this.previousMarks[y][x] !== 'hit' && !view.sunkCells[y][x]) {
            this.lastHitKey = coordKey({ x, y });
          }
        }
      }
    }
    this.previousMarks = view.marks.map((row) => [...row]);

    const hits = unsunkHitKeys(view);
    const recent =
      this.lastHitKey !== null && hits.includes(this.lastHitKey)
        ? [this.lastHitKey]
        : hits;
    if (recent.length > 0 && this.rng() < 0.35) {
      const options: Coord[] = [];
      for (const key of recent) {
        const cell = keyToCoord(key);
        for (const delta of ORTHOGONAL) {
          const neighbour = { x: cell.x + delta.x, y: cell.y + delta.y };
          if (inBounds(neighbour) && view.marks[neighbour.y][neighbour.x] === 'unknown') {
            options.push(neighbour);
          }
        }
      }
      if (options.length > 0) return chooseRandom(options, this.rng);
    }
    return keyToCoord(chooseRandom(unknown, this.rng));
  }
}

const hitClusters = (view: AIView): number[][] => {
  const unvisited = new Set(unsunkHitKeys(view));
  const clusters: number[][] = [];
  while (unvisited.size > 0) {
    const first = unvisited.values().next().value as number;
    const pending = [first];
    const cluster: number[] = [];
    unvisited.delete(first);
    while (pending.length > 0) {
      const key = pending.pop()!;
      cluster.push(key);
      const cell = keyToCoord(key);
      for (const delta of ORTHOGONAL) {
        const neighbour = { x: cell.x + delta.x, y: cell.y + delta.y };
        if (!inBounds(neighbour)) continue;
        const neighbourKey = coordKey(neighbour);
        if (unvisited.delete(neighbourKey)) pending.push(neighbourKey);
      }
    }
    clusters.push(cluster);
  }
  return clusters.sort((a, b) => b.length - a.length);
};

const unknownNeighbours = (cluster: number[], view: AIView): Coord[] => {
  const options: Coord[] = [];
  for (const key of cluster) {
    const cell = keyToCoord(key);
    for (const delta of ORTHOGONAL) {
      const neighbour = { x: cell.x + delta.x, y: cell.y + delta.y };
      if (inBounds(neighbour) && view.marks[neighbour.y][neighbour.x] === 'unknown') {
        options.push(neighbour);
      }
    }
  }
  return options;
};

// ---------------------------------------------------------------------------
// Officer — checkerboard hunt and connected-cluster target tracking.
// ---------------------------------------------------------------------------
class OfficerAI implements AIPlayer {
  constructor(private rng: Rng) {}

  next(view: AIView): Coord {
    requireUntried(view);
    for (const cluster of hitClusters(view)) {
      if (cluster.length >= 2) {
        const cells = cluster.map(keyToCoord);
        const sameX = cells.every((cell) => cell.x === cells[0].x);
        const sameY = cells.every((cell) => cell.y === cells[0].y);
        if (sameX || sameY) {
          const axis = sameX ? 'y' : 'x';
          const ordered = [...cells].sort((a, b) =>
            axis === 'y' ? a.y - b.y : a.x - b.x,
          );
          const lo = ordered[0];
          const hi = ordered[ordered.length - 1];
          const ends =
            axis === 'y'
              ? [{ x: lo.x, y: lo.y - 1 }, { x: hi.x, y: hi.y + 1 }]
              : [{ x: lo.x - 1, y: lo.y }, { x: hi.x + 1, y: hi.y }];
          const available = ends.filter(
            (cell) => inBounds(cell) && view.marks[cell.y][cell.x] === 'unknown',
          );
          if (available.length > 0) return chooseRandom(available, this.rng);
        }
      }
      const neighbours = unknownNeighbours(cluster, view);
      if (neighbours.length > 0) return chooseRandom(neighbours, this.rng);
    }

    const density = densityMap(view, 1);
    const unknown = requireUntried(view);
    const parity = unknown.filter((key) => {
      const { x, y } = keyToCoord(key);
      return (x + y) % 2 === 0 && density[y][x] > 0;
    });
    if (parity.length > 0) return keyToCoord(chooseRandom(parity, this.rng));
    const viable = unknown.filter((key) => {
      const { x, y } = keyToCoord(key);
      return density[y][x] > 0;
    });
    if (viable.length > 0) return keyToCoord(chooseRandom(viable, this.rng));
    return keyToCoord(chooseRandom(unknown, this.rng));
  }
}

// ---------------------------------------------------------------------------
// Commander — linear analytic probability density over legal placements.
// ---------------------------------------------------------------------------
class CommanderAI implements AIPlayer {
  constructor(private rng: Rng) {}

  next(view: AIView): Coord {
    requireUntried(view);
    const map = densityMap(view, 1);
    if (unsunkHitKeys(view).length === 0 && this.rng() < 0.2) {
      const top = untriedKeys(view)
        .map((key) => ({ key, score: map[keyToCoord(key).y][keyToCoord(key).x] }))
        .filter((cell) => cell.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const total = top.reduce((sum, cell) => sum + cell.score, 0);
      if (total > 0) {
        let roll = this.rng() * total;
        for (const cell of top) {
          roll -= cell.score;
          if (roll < 0) return keyToCoord(cell.key);
        }
      }
    }
    return chooseByDensity(map, view, this.rng);
  }
}

export interface AdmiralOptions {
  /** Monte Carlo samples for the rare target positions too tangled to enumerate */
  samples?: number;
  /** placement prior; defaults to the generic human prior (or one learned from `memory`) */
  prior?: PlacementPrior;
  /** this player's deployment history (see prior.ts); sharpens the prior */
  memory?: PlacementMemory | null;
  /** search-node budget for exact posterior enumeration */
  exactBudget?: number;
  /** hunt-mode marginals: per-ship normalised probabilities or raw placement counts */
  huntMarginals?: 'normalized' | 'counts';
}

export const DEFAULT_ADMIRAL_SAMPLES = 3000;
export const DEFAULT_EXACT_BUDGET = 150_000;

/** What an AI was thinking when it chose its last shot (UI / boss hooks). */
export interface AIDecision {
  coord: Coord;
  /** hunt = searching, target = finishing a wounded ship, endgame = exact solve */
  mode: 'hunt' | 'target' | 'endgame' | 'instinct';
  /** the AI's own estimate that this shot hits, 0..1 */
  confidence: number;
}

interface WeightedPlacement {
  placement: Placement;
  weight: number;
  index: number;
}

interface ShipSlot {
  length: number;
  legal: WeightedPlacement[];
  /** legal placements sorted by key, for fast "placements covering cell" lookup */
  byCell: WeightedPlacement[][];
}

interface Posterior {
  /** unnormalised occupancy mass per cell */
  mass: Float64Array;
  total: number;
  mode: AIDecision['mode'];
}

const CELL_COUNT = GRID_SIZE * GRID_SIZE;

const onBorder = (c: Coord) => c.x === 0 || c.y === 0 || c.x === GRID_SIZE - 1 || c.y === GRID_SIZE - 1;

const buildSlots = (view: AIView, prior: PlacementPrior): { slots: ShipSlot[]; blocked: Uint8Array; hit: Uint8Array; hitKeys: number[] } => {
  const blocked = new Uint8Array(CELL_COUNT);
  const hit = new Uint8Array(CELL_COUNT);
  const sunkAdjacent = new Uint8Array(CELL_COUNT);
  const hitKeys: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++)
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = y * GRID_SIZE + x;
      if (view.sunkCells[y][x]) {
        blocked[key] = 1;
        for (const d of ORTHOGONAL) {
          const n = { x: x + d.x, y: y + d.y };
          if (inBounds(n) && !view.sunkCells[n.y][n.x]) sunkAdjacent[coordKey(n)] = 1;
        }
      } else if (view.marks[y][x] === 'miss') blocked[key] = 1;
      else if (view.marks[y][x] === 'hit') {
        hit[key] = 1;
        hitKeys.push(key);
      }
    }
  const byLength = new Map<number, ShipSlot>();
  const slots = view.remainingLengths.map((length) => {
    const cached = byLength.get(length);
    if (cached) return cached;
    const legal: WeightedPlacement[] = [];
    const byCell = Array.from({ length: CELL_COUNT }, () => [] as WeightedPlacement[]);
    placementsFor(length).forEach((placement, index) => {
      let hits = 0;
      let heat = 1;
      for (const key of placement.keys) {
        if (blocked[key]) return;
        hits += hit[key];
        heat *= prior.cell[key];
      }
      let weight = (placement.horizontal ? prior.horizontal : prior.vertical) * Math.pow(heat, 1 / length);
      weight *= placement.cells.some(onBorder) ? prior.edge : prior.interior;
      // Sink-aware: a ship whose every cell is already hit would have been announced sunk.
      if (hits === length) return;
      if (prior.touch !== 1 && placement.keys.some((key) => sunkAdjacent[key])) weight *= prior.touch;
      const entry = { placement, weight, index };
      legal.push(entry);
      for (const key of placement.keys) byCell[key].push(entry);
    });
    const slot = { length, legal, byCell };
    byLength.set(length, slot);
    return slot;
  });
  return { slots, blocked, hit, hitKeys };
};

/** Distinct already-placed ships (by owner id) a placement would touch. */
const touchedOwners = (placement: Placement, owner: Int8Array): number => {
  let mask = 0;
  for (const key of placement.neighbours) if (owner[key] >= 0) mask |= 1 << owner[key];
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count++;
  }
  return count;
};

/**
 * Exact posterior over every complete arrangement of the remaining ships that
 * is consistent with all shots so far. Returns null if the search would
 * exceed the node budget (early game) so callers can fall back.
 */
const exactPosterior = (
  slots: ShipSlot[],
  hitKeys: number[],
  prior: PlacementPrior,
  budget: number,
): Posterior | null => {
  let estimate = 1;
  for (const slot of slots) {
    estimate *= Math.max(1, slot.legal.length);
    if (estimate > budget * 40) return null;
  }
  // Most constrained ships first; identical lengths stay adjacent for symmetry breaking.
  const order = slots
    .map((slot, id) => ({ slot, id }))
    .sort((a, b) => a.slot.legal.length - b.slot.legal.length || a.slot.length - b.slot.length);
  const owner = new Int8Array(CELL_COUNT).fill(-1);
  const isHit = new Uint8Array(CELL_COUNT);
  for (const key of hitKeys) isHit[key] = 1;
  const suffixLength = Array<number>(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) suffixLength[i] = suffixLength[i + 1] + order[i].slot.length;
  const mass = new Float64Array(CELL_COUNT);
  const stack: Placement[] = [];
  const minIndex: number[] = [];
  let total = 0;
  let nodes = 0;
  let aborted = false;

  const visit = (depth: number, weight: number, covered: number) => {
    if (aborted) return;
    if (++nodes > budget) {
      aborted = true;
      return;
    }
    if (hitKeys.length - covered > suffixLength[depth]) return;
    if (depth === order.length) {
      if (covered !== hitKeys.length) return;
      total += weight;
      for (const placement of stack) for (const key of placement.keys) mass[key] += weight;
      return;
    }
    const { slot } = order[depth];
    const sameAsPrevious = depth > 0 && order[depth - 1].slot === slot;
    const from = sameAsPrevious ? minIndex[depth - 1] + 1 : 0;
    for (let i = from; i < slot.legal.length; i++) {
      const entry = slot.legal[i];
      const keys = entry.placement.keys;
      let free = true;
      let newlyCovered = 0;
      for (const key of keys) {
        if (owner[key] >= 0) {
          free = false;
          break;
        }
        newlyCovered += isHit[key];
      }
      if (!free) continue;
      let w = weight * entry.weight;
      if (prior.touch !== 1) {
        const touching = touchedOwners(entry.placement, owner);
        if (touching) w *= Math.pow(prior.touch, touching);
      }
      for (const key of keys) owner[key] = depth;
      stack.push(entry.placement);
      minIndex[depth] = i;
      visit(depth + 1, w, covered + newlyCovered);
      stack.pop();
      for (const key of keys) owner[key] = -1;
      if (aborted) return;
    }
  };
  visit(0, 1, 0);
  if (aborted || total <= 0) return null;
  return { mass, total, mode: 'endgame' };
};

/**
 * Posterior for finishing wounded ships: enumerate every way the remaining
 * ships can explain the unsunk hits, weighting each by how many ways the
 * untouched ships still fit around it.
 */
const targetPosterior = (
  slots: ShipSlot[],
  hitKeys: number[],
  prior: PlacementPrior,
  budget: number,
): Posterior | null => {
  const owner = new Int8Array(CELL_COUNT).fill(-1);
  const isHit = new Uint8Array(CELL_COUNT);
  for (const key of hitKeys) isHit[key] = 1;
  const assigned = Array<boolean>(slots.length).fill(false);
  const stack: Placement[] = [];
  const mass = new Float64Array(CELL_COUNT);
  let total = 0;
  let nodes = 0;
  let aborted = false;

  const freeFactor = (): number => {
    let factor = 1;
    const seen = new Map<ShipSlot, number>();
    slots.forEach((slot, id) => {
      if (!assigned[id]) seen.set(slot, (seen.get(slot) ?? 0) + 1);
    });
    for (const [slot, copies] of seen) {
      let fit = 0;
      for (const entry of slot.legal) {
        let ok = true;
        for (const key of entry.placement.keys)
          if (owner[key] >= 0 || isHit[key]) {
            ok = false;
            break;
          }
        if (ok) fit += entry.weight;
      }
      if (fit <= 0) return 0;
      // Identical free ships are unordered: F^m / m!.
      let term = Math.pow(fit, copies);
      for (let m = 2; m <= copies; m++) term /= m;
      factor *= term;
    }
    return factor;
  };

  const visit = (weight: number) => {
    if (aborted) return;
    if (++nodes > budget) {
      aborted = true;
      return;
    }
    const focus = hitKeys.find((key) => owner[key] < 0);
    if (focus === undefined) {
      const w = weight * freeFactor();
      if (w <= 0) return;
      total += w;
      for (const placement of stack) for (const key of placement.keys) mass[key] += w;
      return;
    }
    const tried = new Set<ShipSlot>();
    for (let id = 0; id < slots.length; id++) {
      if (assigned[id]) continue;
      const slot = slots[id];
      // Identical lengths are interchangeable: only branch on the first free copy.
      if (tried.has(slot)) continue;
      tried.add(slot);
      for (const entry of slot.byCell[focus]) {
        const keys = entry.placement.keys;
        let free = true;
        for (const key of keys)
          if (owner[key] >= 0) {
            free = false;
            break;
          }
        if (!free) continue;
        let w = weight * entry.weight;
        if (prior.touch !== 1) {
          const touching = touchedOwners(entry.placement, owner);
          if (touching) w *= Math.pow(prior.touch, touching);
        }
        for (const key of keys) owner[key] = id;
        assigned[id] = true;
        stack.push(entry.placement);
        visit(w);
        stack.pop();
        assigned[id] = false;
        for (const key of keys) owner[key] = -1;
        if (aborted) return;
      }
    }
  };
  visit(1);
  if (aborted || total <= 0) return null;
  return { mass, total, mode: 'target' };
};

/** Independent per-ship marginals: P(cell) ≈ Σ ships P(ship covers cell). */
const huntPosterior = (slots: ShipSlot[], marginals: 'normalized' | 'counts'): Posterior => {
  const mass = new Float64Array(CELL_COUNT);
  for (const slot of slots) {
    let sum = 0;
    for (const entry of slot.legal) sum += entry.weight;
    if (sum <= 0) continue;
    const scale = marginals === 'normalized' ? 1 / sum : 1;
    for (const entry of slot.legal) for (const key of entry.placement.keys) mass[key] += entry.weight * scale;
  }
  return { mass, total: marginals === 'normalized' ? 1 : 0, mode: 'hunt' };
};

const solvePosterior = (
  slots: ShipSlot[],
  hitKeys: number[],
  prior: PlacementPrior,
  budget: number,
  huntMarginals: 'normalized' | 'counts',
): Posterior | null =>
  exactPosterior(slots, hitKeys, prior, budget) ??
  (hitKeys.length > 0 ? targetPosterior(slots, hitKeys, prior, budget) : huntPosterior(slots, huntMarginals));

/**
 * The Admiral's belief: probability each untried cell holds a ship, plus which
 * solver produced it. Pure; handy for an "Admiral's eye" heatmap.
 */
export const admiralBelief = (
  view: AIView,
  prior: PlacementPrior = priorFromMemory(null),
  budget = DEFAULT_EXACT_BUDGET,
): { map: number[][]; mode: AIDecision['mode'] } | null => {
  const { slots, hitKeys } = buildSlots(view, prior);
  const posterior = solvePosterior(slots, hitKeys, prior, budget, 'normalized');
  if (!posterior) return null;
  const map = Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) =>
      view.marks[y][x] === 'unknown' && posterior.total > 0
        ? Math.min(1, posterior.mass[y * GRID_SIZE + x] / posterior.total)
        : 0,
    ),
  );
  return { map, mode: posterior.mode };
};

// ---------------------------------------------------------------------------
// Admiral — Bayesian fleet inference with a human-placement prior.
// Exact enumeration whenever the search fits a budget (every target phase and
// the endgame), sink-aware elimination, and a prior that learns this player's
// deployment habits across games.
// ---------------------------------------------------------------------------
export class AdmiralAI implements AIPlayer {
  private readonly samples: number;
  private readonly prior: PlacementPrior;
  private readonly exactBudget: number;
  private readonly huntMarginals: 'normalized' | 'counts';
  lastDecision: AIDecision | null = null;

  constructor(
    private rng: Rng,
    options: AdmiralOptions = {},
  ) {
    this.samples = options.samples ?? DEFAULT_ADMIRAL_SAMPLES;
    this.prior = options.prior ?? priorFromMemory(options.memory);
    this.exactBudget = options.exactBudget ?? DEFAULT_EXACT_BUDGET;
    this.huntMarginals = options.huntMarginals ?? 'normalized';
  }

  next(view: AIView): Coord {
    requireUntried(view);
    const { slots, hitKeys } = buildSlots(view, this.prior);
    const posterior = solvePosterior(slots, hitKeys, this.prior, this.exactBudget, this.huntMarginals);

    if (!posterior) {
      const map = monteCarloMap(view, this.rng, this.samples, false);
      const coord = chooseByDensity(map, view, this.rng);
      this.lastDecision = { coord, mode: 'target', confidence: 0.5 };
      return coord;
    }

    const tiebreak = posterior.mode === 'hunt' ? null : huntPosterior(slots, 'normalized').mass;
    let best = -1;
    const keys: number[] = [];
    for (let key = 0; key < CELL_COUNT; key++) {
      const { x, y } = keyToCoord(key);
      if (view.marks[y][x] !== 'unknown') continue;
      const score = posterior.mass[key] + (tiebreak ? tiebreak[key] * posterior.total * 1e-6 : 0);
      if (score > best + 1e-12 * Math.max(1, best)) {
        best = score;
        keys.length = 0;
        keys.push(key);
      } else if (Math.abs(score - best) <= 1e-12 * Math.max(1, best)) keys.push(key);
    }
    if (keys.length === 0 || best <= 0) {
      const coord = keyToCoord(chooseRandom(requireUntried(view), this.rng));
      this.lastDecision = { coord, mode: 'instinct', confidence: 0 };
      return coord;
    }
    const pick = chooseRandom(keys, this.rng);
    const coord = keyToCoord(pick);
    const confidence =
      posterior.total > 0 ? Math.min(1, posterior.mass[pick] / posterior.total) : 0;
    this.lastDecision = { coord, mode: posterior.mode, confidence };
    return coord;
  }
}

export const probabilityHeatmap = (view: AIView): number[][] => {
  const map = densityMap(view, 1);
  let max = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (view.marks[y][x] === 'unknown') max = Math.max(max, map[y][x]);
      else map[y][x] = 0;
    }
  }
  if (max > 0) {
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++) map[y][x] /= max;
  }
  return map;
};

export interface MakeAIOptions {
  /** the player's deployment history; only the Admiral reads it */
  memory?: PlacementMemory | null;
}

export const makeAI = (
  difficulty: Difficulty,
  rng: Rng = Math.random,
  options: MakeAIOptions = {},
): AIPlayer => {
  switch (difficulty) {
    case 'cadet':
      return new CadetAI(rng);
    case 'officer':
      return new OfficerAI(rng);
    case 'commander':
      return new CommanderAI(rng);
    case 'admiral':
      return new AdmiralAI(rng, { memory: options.memory });
  }
};

// ---------------------------------------------------------------------------
// Tier personalities: pacing and voice for the UI / boss layer.
// ---------------------------------------------------------------------------
export type TauntKind = 'open' | 'hit' | 'miss' | 'sink' | 'hurt' | 'win' | 'lose' | 'read';

export interface TierPersonality {
  /** min / max "thinking" pause before the AI fires, in ms */
  thinkMs: readonly [number, number];
  /** how the tier thinks out loud (status line while it deliberates) */
  thinking: string;
  taunts: Record<TauntKind, readonly string[]>;
}

export const TIER_PERSONALITY: Record<Difficulty, TierPersonality> = {
  cadet: {
    thinkMs: [380, 1500],
    thinking: 'Re-running the suite until it passes…',
    taunts: {
      open: ['Works on my machine!', 'Tests are green. Mostly.'],
      hit: ['Wait, that passed?', 'Lucky retry!'],
      miss: ['Flaked. Retrying…', 'Probably a timing issue.'],
      sink: ['Green build! Screenshot it!', 'Shipping before it flakes again!'],
      hurt: ['That one was always flaky.', 'Marking it @skip.'],
      win: ['Merged on the fourth retry!'],
      lose: ['Quarantined. Again.'],
      read: ['I forgot your last layout. I forget everything.'],
    },
  },
  officer: {
    thinkMs: [600, 1150],
    thinking: 'Resolving conflicts line by line…',
    taunts: {
      open: ['Checkerboard sweep, by the book.', 'Rebasing onto your fleet.'],
      hit: ['Conflict found. Resolving.', 'Walking the line now.'],
      miss: ['Clean merge. Nothing here.', 'Skipping that hunk.'],
      sink: ['Conflict resolved: theirs.', 'Force-pushed over your hull.'],
      hurt: ['Who touched my branch?', 'That was a bad rebase.'],
      win: ['Fast-forward merge complete.'],
      lose: ['Rebase aborted.'],
      read: ['I diffed your last deployment. Familiar.'],
    },
  },
  commander: {
    thinkMs: [750, 1250],
    thinking: 'Triaging the probability backlog…',
    taunts: {
      open: ['Every cell has a CVSS score.', 'Heatmap compiled. You glow.'],
      hit: ['Exploit confirmed.', 'Severity: critical.'],
      miss: ['False positive. Logged.', 'Risk accepted.'],
      sink: ['Vulnerability closed — yours.', 'Patched you out of existence.'],
      hurt: ['That was a zero-day!', 'Escalating to SEV-1.'],
      win: ['Audit complete. You failed it.'],
      lose: ['Backlog… overflowing…'],
      read: ['Your layout is in my threat model now.'],
    },
  },
  admiral: {
    thinkMs: [900, 1600],
    thinking: 'Enumerating every fleet you could have built…',
    taunts: {
      open: [
        'I have simulated this battle since 1987.',
        'Your fleet is a posterior distribution. I sample it.',
      ],
      hit: ['As computed.', 'The batch job predicted that.', 'Posterior confirmed.'],
      miss: ['A rounding error. In COBOL, those are features.', 'Pruned. One less branch.'],
      sink: ['Deprecated.', 'Sunset with no migration path.', 'Your ship was in my cache.'],
      hurt: ['Impossible. I compiled for this.', 'A segfault in my mainframe?!'],
      win: ['Batch complete. Every fleet. Every outcome.'],
      lose: ['Migrating… to… Devin…'],
      read: ['I remember how you deploy.', 'Same habits as last time. I logged them.'],
    },
  },
};

/** Pause before the AI fires. Decisive Admirals fire faster; hunting ones brood. */
export const thinkDelayMs = (
  difficulty: Difficulty,
  rng: Rng = Math.random,
  decision?: AIDecision | null,
): number => {
  const [lo, hi] = TIER_PERSONALITY[difficulty].thinkMs;
  const base = lo + rng() * (hi - lo);
  if (!decision) return Math.round(base);
  if (decision.mode === 'endgame' && decision.confidence >= 0.99) return Math.round(lo * 0.6);
  if (decision.confidence >= 0.6) return Math.round(lo + (base - lo) * 0.35);
  return Math.round(base);
};

/** Pick a line from the tier's pool; `read` falls back to the generic pool when no tell is known. */
export const pickTaunt = (difficulty: Difficulty, kind: TauntKind, rng: Rng = Math.random): string => {
  const pool = TIER_PERSONALITY[difficulty].taunts[kind];
  return pool[Math.floor(rng() * pool.length)];
};
