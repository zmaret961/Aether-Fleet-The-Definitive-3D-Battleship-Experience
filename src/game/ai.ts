import { GRID_SIZE, ORTHOGONAL, coordKey, inBounds, keyToCoord } from './types';
import type { Coord, Orientation, Rng } from './types';
import { shipCellsFor } from './board';

export type Difficulty = 'cadet' | 'officer' | 'commander' | 'admiral';

export const DIFFICULTY_INFO: Record<
  Difficulty,
  { label: string; tagline: string; description: string }
> = {
  cadet: {
    label: 'Flaky Test',
    tagline: 'Mostly green',
    description: 'Only fails when someone important is watching.',
  },
  officer: {
    label: 'Merge Conflict',
    tagline: 'Nobody owns this branch',
    description: 'Can resolve anything except its own rebase.',
  },
  commander: {
    label: 'CVE Backlog',
    tagline: 'CVSS 10.0 personality',
    description: 'Prioritizes every risk. Patches absolutely nothing.',
  },
  admiral: {
    label: 'The Legacy Monolith',
    tagline: 'Last touched in 1987',
    description: 'Compiles at dawn. Nobody knows why it works.',
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

const untriedKeys = (view: AIView): number[] => {
  const out: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++)
    for (let x = 0; x < GRID_SIZE; x++) if (view.marks[y][x] === 'unknown') out.push(coordKey({ x, y }));
  return out;
};

const unsunkHitKeys = (view: AIView): number[] => {
  const out: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++)
    for (let x = 0; x < GRID_SIZE; x++)
      if (view.marks[y][x] === 'hit' && !view.sunkCells[y][x]) out.push(coordKey({ x, y }));
  return out;
};

/** Legal placements for a ship of `length` given what the AI knows. */
function* legalPlacements(
  view: AIView,
  length: number,
): Generator<{ cells: Coord[]; hitsCovered: number; endsAtHit: boolean }> {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (const orientation of ['h', 'v'] as Orientation[]) {
        const cells = shipCellsFor({ x, y }, orientation, length);
        if (!cells.every(inBounds)) continue;
        let legal = true;
        let hitsCovered = 0;
        for (const c of cells) {
          const m = view.marks[c.y][c.x];
          if (m === 'miss' || view.sunkCells[c.y][c.x]) {
            legal = false;
            break;
          }
          if (m === 'hit') hitsCovered++;
        }
        if (!legal) continue;
        const end = cells[cells.length - 1];
        const start = cells[0];
        const endsAtHit =
          view.marks[start.y][start.x] === 'hit' && !view.sunkCells[start.y][start.x] ||
          view.marks[end.y][end.x] === 'hit' && !view.sunkCells[end.y][end.x];
        yield { cells, hitsCovered, endsAtHit };
      }
    }
  }
}

/**
 * Probability density over all cells. When unsunk hits exist (target mode) only
 * placements covering them count and each placement's weight is hitsCovered^power —
 * the shared engine for Commander (power 1) and Admiral (power 2 + endpoints).
 */
const densityMap = (view: AIView, hitPower: number, lengthWeighted = false): number[][] => {
  const map = Array.from({ length: GRID_SIZE }, () => Array<number>(GRID_SIZE).fill(0));
  const targetMode = unsunkHitKeys(view).length > 0;
  for (const length of view.remainingLengths) {
    for (const p of legalPlacements(view, length)) {
      if (targetMode && p.hitsCovered === 0) continue;
      const weight = targetMode ? Math.pow(p.hitsCovered, hitPower) : lengthWeighted ? length : 1;
      for (const c of p.cells) map[c.y][c.x] += weight;
    }
  }
  return map;
};

const argmaxWithNoise = (map: number[][], view: AIView, rng: Rng): Coord => {
  let best = -1;
  const keys: number[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (view.marks[y][x] !== 'unknown') continue;
      const v = map[y][x];
      if (v > best) {
        best = v;
        keys.length = 0;
        keys.push(coordKey({ x, y }));
      } else if (v === best && v > 0) {
        keys.push(coordKey({ x, y }));
      }
    }
  }
  if (keys.length === 0) {
    const untried = untriedKeys(view);
    return keyToCoord(untried[Math.floor(rng() * untried.length)]);
  }
  return keyToCoord(keys[Math.floor(rng() * keys.length)]);
};

// ---------------------------------------------------------------------------
// Cadet — random with a light instinct to chase a hit.
// ---------------------------------------------------------------------------
class CadetAI implements AIPlayer {
  constructor(private rng: Rng) {}
  next(view: AIView): Coord {
    const hits = unsunkHitKeys(view);
    if (hits.length > 0 && this.rng() < 0.45) {
      // Chase: pick a random untried orthogonal neighbour of a random unsunk hit.
      const options: Coord[] = [];
      for (const k of hits) {
        const c = keyToCoord(k);
        for (const d of ORTHOGONAL) {
          const n = { x: c.x + d.x, y: c.y + d.y };
          if (inBounds(n) && view.marks[n.y][n.x] === 'unknown') options.push(n);
        }
      }
      if (options.length > 0) return options[Math.floor(this.rng() * options.length)];
    }
    const untried = untriedKeys(view);
    return keyToCoord(untried[Math.floor(this.rng() * untried.length)]);
  }
}

// ---------------------------------------------------------------------------
// Officer — hunt/target with checkerboard parity.
// ---------------------------------------------------------------------------
class OfficerAI implements AIPlayer {
  constructor(private rng: Rng) {}
  next(view: AIView): Coord {
    const hits = unsunkHitKeys(view);
    if (hits.length > 0) {
      // If unsunk hits form an aligned run, extend the line first.
      const coords = hits.map(keyToCoord);
      const sameX = coords.every((c) => c.x === coords[0].x);
      const sameY = coords.every((c) => c.y === coords[0].y);
      const ends: Coord[] = [];
      if (sameX || sameY) {
        const axis = sameX ? 'y' : 'x';
        const sorted = [...coords].sort((a, b) => (axis === 'y' ? a.y - b.y : a.x - b.x));
        const lo = sorted[0];
        const hi = sorted[sorted.length - 1];
        const candidates =
          axis === 'y'
            ? [{ x: lo.x, y: lo.y - 1 }, { x: hi.x, y: hi.y + 1 }]
            : [{ x: lo.x - 1, y: lo.y }, { x: hi.x + 1, y: hi.y }];
        for (const c of candidates) if (inBounds(c) && view.marks[c.y][c.x] === 'unknown') ends.push(c);
      }
      if (ends.length > 0) return ends[Math.floor(this.rng() * ends.length)];
      const options: Coord[] = [];
      for (const c of coords) {
        for (const d of ORTHOGONAL) {
          const n = { x: c.x + d.x, y: c.y + d.y };
          if (inBounds(n) && view.marks[n.y][n.x] === 'unknown') options.push(n);
        }
      }
      if (options.length > 0) return options[Math.floor(this.rng() * options.length)];
    }
    // Hunt on checkerboard parity — the smallest fleet ship is length 2.
    const parityPool = untriedKeys(view).filter((k) => {
      const c = keyToCoord(k);
      return (c.x + c.y) % 2 === 0;
    });
    const finalPool = parityPool.length > 0 ? parityPool : untriedKeys(view);
    return keyToCoord(finalPool[Math.floor(this.rng() * finalPool.length)]);
  }
}

// ---------------------------------------------------------------------------
// Commander — full probability density, linear hit weighting.
// ---------------------------------------------------------------------------
class CommanderAI implements AIPlayer {
  constructor(private rng: Rng) {}
  next(view: AIView): Coord {
    return argmaxWithNoise(densityMap(view, 1), view, this.rng);
  }
}

// ---------------------------------------------------------------------------
// Admiral — density warfare: quadratic hit weighting, endpoint priority, and a
// weighted pick from the top cells in hunt mode for controlled uncertainty.
// ---------------------------------------------------------------------------
class AdmiralAI implements AIPlayer {
  constructor(private rng: Rng) {}
  next(view: AIView): Coord {
    const targetMode = unsunkHitKeys(view).length > 0;
    const map = densityMap(view, 2, true);
    if (targetMode) {
      // Boost cells that sit at the ends of placements covering hits — ships
      // are resolved fastest by extending along the suspected axis.
      for (const length of view.remainingLengths) {
        for (const p of legalPlacements(view, length)) {
          if (p.hitsCovered === 0) continue;
          if (p.endsAtHit || p.hitsCovered >= 2) {
            for (const c of p.cells) if (view.marks[c.y][c.x] === 'unknown') map[c.y][c.x] *= 1.6;
          }
        }
      }
      return argmaxWithNoise(map, view, this.rng);
    }
    // Hunt: density weighted toward the largest surviving ships plus a parity
    // bias — adaptive pressure that still plays legally.
    const minLen = Math.min(...view.remainingLengths);
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++)
        if (view.marks[y][x] === 'unknown' && minLen >= 2 && (x + y) % 2 === 0) map[y][x] *= 1.35;
    return argmaxWithNoise(map, view, this.rng);
  }
}

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
