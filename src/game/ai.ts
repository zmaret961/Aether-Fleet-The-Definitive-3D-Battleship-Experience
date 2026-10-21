import { GRID_SIZE, ORTHOGONAL, coordKey, inBounds, keyToCoord } from './types';
import type { Coord, Orientation, Rng } from './types';
import { shipCellsFor } from './board';

export type Difficulty = 'cadet' | 'officer' | 'commander' | 'admiral';

export const DIFFICULTY_INFO: Record<
  Difficulty,
  {
    label: string;
    tagline: string;
    description: string;
    rank: 1 | 2 | 3 | 4;
    doctrine: string;
    avgShots: number;
  }
> = {
  cadet: {
    label: 'Flaky Test',
    tagline: 'Mostly green',
    description: 'Only fails when someone important is watching.',
    rank: 1,
    doctrine: 'Fires at random. Chases a hit about a third of the time — when it remembers.',
    avgShots: 74,
  },
  officer: {
    label: 'Merge Conflict',
    tagline: 'Nobody owns this branch',
    description: 'Can resolve anything except its own rebase.',
    rank: 2,
    doctrine: 'Textbook hunt/target: checkerboard sweeps, then walks the line once it lands a hit.',
    avgShots: 50,
  },
  commander: {
    label: 'CVE Backlog',
    tagline: 'CVSS 10.0 personality',
    description: 'Prioritizes every risk. Patches absolutely nothing.',
    rank: 3,
    doctrine: 'Builds a probability heatmap of every legal ship placement and fires at the hottest cell.',
    avgShots: 45,
  },
  admiral: {
    label: 'The Legacy Monolith',
    tagline: 'Last touched in 1987',
    description: 'Compiles at dawn. Nobody knows why it works.',
    rank: 4,
    doctrine: 'Simulates thousands of fleets consistent with every shot so far and fires where your ships most likely are.',
    avgShots: 44,
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
}

interface Placement {
  cells: Coord[];
  keys: number[];
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
        if (cells.every(inBounds)) placements.push({ cells, keys: cells.map(coordKey) });
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

const preferredTargetKeys = (view: AIView): number[] => {
  const clusters = hitClusters(view);
  const cluster = clusters[0];
  if (!cluster || cluster.length === 0) return [];
  const cells = cluster.map(keyToCoord);
  if (cluster.length >= 2) {
    const sameX = cells.every((cell) => cell.x === cells[0].x);
    const sameY = cells.every((cell) => cell.y === cells[0].y);
    if (sameX || sameY) {
      const axis = sameX ? 'y' : 'x';
      const ordered = [...cells].sort((a, b) => (axis === 'y' ? a.y - b.y : a.x - b.x));
      const lo = ordered[0];
      const hi = ordered[ordered.length - 1];
      const ends =
        axis === 'y'
          ? [{ x: lo.x, y: lo.y - 1 }, { x: hi.x, y: hi.y + 1 }]
          : [{ x: lo.x - 1, y: lo.y }, { x: hi.x + 1, y: hi.y }];
      return ends
        .filter((cell) => inBounds(cell) && view.marks[cell.y][cell.x] === 'unknown')
        .map(coordKey);
    }
  }
  return unknownNeighbours(cluster, view).map(coordKey);
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
  samples?: number;
  huntSamples?: number;
  importanceWeighting?: boolean;
  huntMode?: 'analytic' | 'monte-carlo';
}

export const DEFAULT_ADMIRAL_SAMPLES = 3000;

// ---------------------------------------------------------------------------
// Admiral — posterior fleet sampling for target and hunt decisions.
// ---------------------------------------------------------------------------
export class AdmiralAI implements AIPlayer {
  private readonly samples: number;
  private readonly huntSamples: number;
  private readonly importanceWeighting: boolean;
  private readonly huntMode: 'analytic' | 'monte-carlo';

  constructor(
    private rng: Rng,
    options: AdmiralOptions = {},
  ) {
    this.samples = options.samples ?? DEFAULT_ADMIRAL_SAMPLES;
    this.huntSamples = options.huntSamples ?? this.samples;
    this.importanceWeighting = options.importanceWeighting ?? false;
    this.huntMode = options.huntMode ?? 'analytic';
  }

  next(view: AIView): Coord {
    requireUntried(view);
    if (unsunkHitKeys(view).length > 0) {
      const posterior = monteCarloMap(view, this.rng, this.samples, this.importanceWeighting);
      if (posterior.some((row) => row.some((score) => score > 0))) {
        const preferred = preferredTargetKeys(view);
        if (preferred.some((key) => posterior[keyToCoord(key).y][keyToCoord(key).x] > 0)) {
          for (let y = 0; y < GRID_SIZE; y++)
            for (let x = 0; x < GRID_SIZE; x++)
              if (!preferred.includes(coordKey({ x, y }))) posterior[y][x] = 0;
        }
        return chooseByDensity(posterior, view, this.rng);
      }
      return chooseByDensity(densityMap(view, 2), view, this.rng);
    }

    const map =
      this.huntMode === 'monte-carlo'
        ? monteCarloMap(view, this.rng, this.huntSamples, this.importanceWeighting)
        : densityMap(view, 1);
    return chooseByDensity(map, view, this.rng);
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

export const makeAI = (difficulty: Difficulty, rng: Rng = Math.random): AIPlayer => {
  switch (difficulty) {
    case 'cadet':
      return new CadetAI(rng);
    case 'officer':
      return new OfficerAI(rng);
    case 'commander':
      return new CommanderAI(rng);
    case 'admiral':
      return new AdmiralAI(rng);
  }
};
