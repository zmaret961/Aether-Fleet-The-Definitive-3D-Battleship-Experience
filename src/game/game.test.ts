import { describe, expect, it } from 'vitest';
import {
  boardSignature,
  canPlace,
  createBoard,
  fireAt,
  placeShip,
  randomLayout,
  removeShip,
  validateFleet,
} from './board';
import { AdmiralAI, makeAI, probabilityHeatmap } from './ai';
import type { AIView, Difficulty } from './ai';
import { accuracy, aiView, createMatch, matchStats, shoot } from './engine';
import { createRng } from './rng';
import { FLEET, GRID_SIZE, shipSpec } from './types';
import type { Coord } from './types';

const emptyView = (remainingLengths = [5, 4, 3, 3, 2]): AIView => ({
  marks: Array.from({ length: GRID_SIZE }, () => Array<'unknown' | 'miss' | 'hit'>(GRID_SIZE).fill('unknown')),
  sunkCells: Array.from({ length: GRID_SIZE }, () => Array<boolean>(GRID_SIZE).fill(false)),
  remainingLengths,
});

const runGame = (difficulty: Difficulty, seed: number, aiSeed = seed + 900_001): number => {
  const board = randomLayout(createRng(seed));
  const ai = makeAI(difficulty, createRng(aiSeed));
  const match = createMatch(board, createBoard());
  match.turn = 'ai';
  let shots = 0;
  while (!match.winner && shots < 100) {
    match.turn = 'ai';
    const coord = ai.next(aiView(match));
    expect(coord.x).toBeGreaterThanOrEqual(0);
    expect(coord.x).toBeLessThan(GRID_SIZE);
    expect(coord.y).toBeGreaterThanOrEqual(0);
    expect(coord.y).toBeLessThan(GRID_SIZE);
    const result = shoot(match, 'ai', coord);
    expect(result.outcome.kind).not.toBe('already');
    shots++;
  }
  expect(match.winner).toBe('ai');
  expect(shots).toBeLessThanOrEqual(100);
  return shots;
};

const runSequence = (difficulty: Difficulty, seed: number): Coord[] => {
  const ai = makeAI(difficulty, createRng(seed + 1));
  const match = createMatch(randomLayout(createRng(seed)), createBoard());
  match.turn = 'ai';
  const sequence: Coord[] = [];
  while (!match.winner && sequence.length < 100) {
    match.turn = 'ai';
    const coord = ai.next(aiView(match));
    sequence.push(coord);
    shoot(match, 'ai', coord);
  }
  return sequence;
};

describe('board', () => {
  it('rejects overlapping, out-of-bounds and duplicate-id placements', () => {
    const board = createBoard();
    expect(placeShip(board, shipSpec('carrier'), { x: 0, y: 0 }, 'h')).toBe(true);
    expect(placeShip(board, shipSpec('carrier'), { x: 0, y: 1 }, 'h')).toBe(false);
    expect(placeShip(board, { id: 'invalid', name: 'Invalid', length: 0 }, { x: 0, y: 0 }, 'h')).toBe(
      false,
    );
    expect(canPlace(board, { x: 3, y: 0 }, 'h', 3)).toBe(false);
    expect(canPlace(board, { x: 8, y: 0 }, 'h', 3)).toBe(false);
    expect(canPlace(board, { x: 0, y: 9 }, 'v', 2)).toBe(false);
    expect(canPlace(board, { x: 1, y: 1 }, 'v', 5)).toBe(true);
  });

  it('rejects non-integer and out-of-bounds shots without mutation', () => {
    const board = createBoard();
    placeShip(board, shipSpec('destroyer'), { x: 0, y: 0 }, 'h');
    const before = JSON.stringify(board);
    for (const coord of [
      { x: 0.5, y: 0 },
      { x: -1, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]) {
      expect(fireAt(board, coord)).toEqual({ kind: 'already' });
      expect(JSON.stringify(board)).toBe(before);
    }
  });

  it('marks an orphaned shipAt reference as a safe miss', () => {
    const board = createBoard();
    board.shipAt[2][2] = 'missing-ship';
    expect(fireAt(board, { x: 2, y: 2 })).toEqual({ kind: 'miss' });
    expect(board.marks[2][2]).toBe('miss');
    expect(board.ships).toHaveLength(0);
  });

  it('only sinks after the last cell and wins on the last ship', () => {
    const board = createBoard();
    placeShip(board, shipSpec('destroyer'), { x: 0, y: 0 }, 'h');
    placeShip(board, shipSpec('cruiser'), { x: 0, y: 2 }, 'h');
    expect(fireAt(board, { x: 0, y: 0 }).kind).toBe('hit');
    expect(board.ships[0].sunk).toBe(false);
    expect(fireAt(board, { x: 1, y: 0 }).kind).toBe('sunk');
    expect(board.ships[0].sunk).toBe(true);
    expect(fireAt(board, { x: 0, y: 2 }).kind).toBe('hit');
    expect(fireAt(board, { x: 1, y: 2 }).kind).toBe('hit');
    expect(fireAt(board, { x: 2, y: 2 }).kind).toBe('win');
  });

  it('removeShip clears its shipAt cells', () => {
    const board = createBoard();
    placeShip(board, shipSpec('destroyer'), { x: 3, y: 4 }, 'v');
    removeShip(board, 'destroyer');
    expect(board.ships).toHaveLength(0);
    expect(board.shipAt[4][3]).toBeNull();
    expect(board.shipAt[5][3]).toBeNull();
  });

  it('validates random layouts and reproduces a seeded layout', () => {
    for (let seed = 0; seed < 200; seed++) {
      const board = randomLayout(createRng(seed));
      expect(board.ships).toHaveLength(FLEET.length);
      expect(validateFleet(board)).toEqual([]);
    }
    expect(boardSignature(randomLayout(createRng(193)))).toBe(
      boardSignature(randomLayout(createRng(193))),
    );
  });

  it('detects missing, duplicate, overlapping, discontinuous, out-of-bounds and shipAt corruption', () => {
    const createValid = () => randomLayout(createRng(73));

    const missing = createValid();
    missing.ships = missing.ships.filter((ship) => ship.spec.id !== 'carrier');
    expect(validateFleet(missing).join('|')).toContain('Missing ship: carrier');

    const duplicate = createValid();
    duplicate.ships.push({ ...duplicate.ships[0], cells: duplicate.ships[0].cells.map((c) => ({ ...c })) });
    expect(validateFleet(duplicate).join('|')).toContain('Duplicate ship:');

    const overlap = createValid();
    const [first, second] = overlap.ships;
    second.cells[0] = { ...first.cells[0] };
    expect(validateFleet(overlap).join('|')).toContain('Overlapping ships');

    const discontinuous = createValid();
    const gapShip = discontinuous.ships.find((ship) => ship.spec.length >= 3)!;
    const origin = gapShip.cells[0];
    gapShip.cells[1] = {
      x: origin.x < GRID_SIZE - 1 ? origin.x + 1 : origin.x - 1,
      y: origin.y < GRID_SIZE - 1 ? origin.y + 1 : origin.y - 1,
    };
    expect(validateFleet(discontinuous).join('|')).toContain('Non-contiguous cells');

    const outOfBounds = createValid();
    outOfBounds.ships[0].cells[0] = { x: GRID_SIZE, y: 0 };
    expect(validateFleet(outOfBounds).join('|')).toContain('Out-of-bounds cell');

    const shipAtMismatch = createValid();
    const cell = shipAtMismatch.ships[0].cells[0];
    shipAtMismatch.shipAt[cell.y][cell.x] = null;
    expect(validateFleet(shipAtMismatch).join('|')).toContain('shipAt mismatch');

    const stray = createValid();
    stray.shipAt[0][0] = 'stray';
    expect(validateFleet(stray).join('|')).toContain('Unexpected shipAt value');
  });
});

describe('engine', () => {
  it('rejects out-of-turn shots without logging and flips after valid shots', () => {
    const enemy = createBoard();
    placeShip(enemy, shipSpec('destroyer'), { x: 5, y: 5 }, 'h');
    const match = createMatch(createBoard(), enemy);
    const rejected = shoot(match, 'ai', { x: 0, y: 0 });
    expect(rejected.outcome.kind).toBe('already');
    expect(match.log).toHaveLength(0);
    expect(enemy.marks[0][0]).toBe('unknown');
    expect(shoot(match, 'player', { x: 0, y: 0 }).outcome.kind).toBe('miss');
    expect(match.turn).toBe('ai');
  });

  it('leaves the turn on a winner and rejects every shot after the match ends', () => {
    const enemy = createBoard();
    placeShip(enemy, shipSpec('destroyer'), { x: 5, y: 5 }, 'h');
    const player = createBoard();
    placeShip(player, shipSpec('destroyer'), { x: 0, y: 0 }, 'h');
    const match = createMatch(player, enemy);
    shoot(match, 'player', { x: 5, y: 5 });
    shoot(match, 'ai', { x: 0, y: 0 });
    match.turn = 'player';
    expect(shoot(match, 'player', { x: 6, y: 5 }).outcome.kind).toBe('win');
    expect(match.winner).toBe('player');
    expect(match.turn).toBe('player');
    const logLength = match.log.length;
    expect(shoot(match, 'player', { x: 0, y: 0 }).outcome.kind).toBe('already');
    expect(match.log).toHaveLength(logLength);
  });

  it('provides a detached AI view without revealing unhit ships', () => {
    const player = createBoard();
    placeShip(player, shipSpec('carrier'), { x: 0, y: 0 }, 'h');
    const match = createMatch(player, createBoard());
    const view = aiView(match);
    expect(view.remainingLengths).toEqual([5]);
    expect(view.marks.flat().every((mark) => mark === 'unknown')).toBe(true);
    expect(view.marks.flat().filter((mark) => mark !== 'unknown')).toHaveLength(0);
    view.marks[0][0] = 'miss';
    view.sunkCells[0][0] = true;
    expect(player.marks[0][0]).toBe('unknown');
  });

  it('computes player and AI statistics including consecutive player hits', () => {
    const player = createBoard();
    placeShip(player, shipSpec('destroyer'), { x: 5, y: 0 }, 'h');
    const enemy = createBoard();
    placeShip(enemy, shipSpec('destroyer'), { x: 0, y: 0 }, 'h');
    placeShip(enemy, shipSpec('cruiser'), { x: 0, y: 2 }, 'h');
    const match = createMatch(player, enemy);

    shoot(match, 'player', { x: 0, y: 0 });
    shoot(match, 'ai', { x: 9, y: 9 });
    shoot(match, 'player', { x: 0, y: 2 });
    shoot(match, 'ai', { x: 5, y: 0 });
    shoot(match, 'player', { x: 9, y: 8 });
    shoot(match, 'ai', { x: 6, y: 0 });

    expect(match.winner).toBe('ai');
    expect(accuracy(match, 'player')).toEqual({ shots: 3, hits: 2, pct: 67 });
    expect(
      matchStats(match, 'officer'),
    ).toMatchObject({
      difficulty: 'officer',
      winner: 'ai',
      shots: 3,
      hits: 2,
      accuracyPct: 67,
      aiShots: 3,
      aiHits: 2,
      aiAccuracyPct: 67,
      playerShipsLost: 1,
      longestHitStreak: 2,
    });
  });
});

describe('AI legality and determinism', () => {
  it.each(['cadet', 'officer', 'commander', 'admiral'] as Difficulty[])(
    '%s never repeats or leaves the board across 25 seeds',
    (difficulty) => {
      for (let seed = 1; seed <= 25; seed++) {
        const shots = runSequence(difficulty, seed * 7919);
        expect(shots.length).toBeLessThanOrEqual(100);
        expect(new Set(shots.map((coord) => coord.y * GRID_SIZE + coord.x)).size).toBe(shots.length);
      }
    },
    60_000,
  );

  it.each(['cadet', 'officer', 'commander', 'admiral'] as Difficulty[])(
    '%s produces the same seeded shot sequence',
    (difficulty) => {
      expect(runSequence(difficulty, 8431)).toEqual(runSequence(difficulty, 8431));
    },
  );

  it.each(['cadet', 'officer', 'commander', 'admiral'] as Difficulty[])(
    '%s rejects a view with no legal shots',
    (difficulty) => {
      const view = emptyView();
      view.marks = view.marks.map((row) => row.map(() => 'miss'));
      expect(() => makeAI(difficulty, createRng(2)).next(view)).toThrow('No legal shots remain');
    },
  );
});

describe('AI doctrines', () => {
  it('Officer hunt shots stay on viable checkerboard cells', () => {
    const view = emptyView();
    const ai = makeAI('officer', createRng(201));
    for (let shot = 0; shot < 20; shot++) {
      const coord = ai.next(view);
      expect((coord.x + coord.y) % 2).toBe(0);
      expect(probabilityHeatmap(view)[coord.y][coord.x]).toBeGreaterThan(0);
      view.marks[coord.y][coord.x] = 'miss';
    }
  });

  it('Officer skips dead parity cells in hunt mode', () => {
    const view = emptyView([5]);
    view.marks = view.marks.map((row) => row.map(() => 'miss'));
    for (let x = 0; x < 5; x++) view.marks[0][x] = 'unknown';
    view.marks[5][5] = 'unknown';
    const coord = makeAI('officer', createRng(9)).next(view);
    expect(coord.y).toBe(0);
    expect((coord.x + coord.y) % 2).toBe(0);
  });

  it('Officer extends a horizontal two-hit cluster at an open line end', () => {
    const view = emptyView();
    view.marks[5][4] = 'hit';
    view.marks[5][5] = 'hit';
    const coord = makeAI('officer', createRng(11)).next(view);
    expect(coord.y).toBe(5);
    expect([3, 6]).toContain(coord.x);
  });

  it('Admiral targets orthogonal neighbors of a single hit', () => {
    const view = emptyView();
    view.marks[5][5] = 'hit';
    const coord = new AdmiralAI(createRng(33), { samples: 1800 }).next(view);
    expect(Math.abs(coord.x - 5) + Math.abs(coord.y - 5)).toBe(1);
  });

  it('Admiral extends a two-hit horizontal line', () => {
    const view = emptyView();
    view.marks[5][4] = 'hit';
    view.marks[5][5] = 'hit';
    const coord = new AdmiralAI(createRng(34), { samples: 1800 }).next(view);
    expect(coord.y).toBe(5);
    expect([3, 6]).toContain(coord.x);
  });

  it('Admiral does not fire into a pocket no remaining ship can fit', () => {
    const view = emptyView([5]);
    for (let x = 3; x <= 6; x++) {
      view.marks[5][x] = 'unknown';
      view.marks[4][x] = 'miss';
      view.marks[6][x] = 'miss';
    }
    view.marks[5][2] = 'miss';
    view.marks[5][7] = 'miss';
    const coord = new AdmiralAI(createRng(35), { samples: 1200 }).next(view);
    expect(coord.y === 5 && coord.x >= 3 && coord.x <= 6).toBe(false);
    expect(probabilityHeatmap(view)[5].slice(3, 7)).toEqual([0, 0, 0, 0]);
  });

  it('Admiral excludes sunk cells after a sink', () => {
    const view = emptyView([4, 3]);
    view.marks[5][4] = 'hit';
    view.marks[5][5] = 'hit';
    view.sunkCells[5][4] = true;
    view.sunkCells[5][5] = true;
    const heatmap = probabilityHeatmap(view);
    expect(heatmap[5][4]).toBe(0);
    expect(heatmap[5][5]).toBe(0);
    const coord = new AdmiralAI(createRng(36), { samples: 1200 }).next(view);
    expect(view.sunkCells[coord.y][coord.x]).toBe(false);
  });

  it('normalizes the probability heatmap and zeros tried cells', () => {
    const view = emptyView();
    view.marks[0][0] = 'miss';
    view.marks[2][2] = 'hit';
    const heatmap = probabilityHeatmap(view);
    expect(Math.max(...heatmap.flat())).toBe(1);
    expect(heatmap[0][0]).toBe(0);
    expect(heatmap[2][2]).toBe(0);
  });
});

describe('AI strength', () => {
  it(
    'strictly improves by tier and Admiral beats Commander by at least 1.5 shots',
    () => {
    const averages = new Map<Difficulty, number>();
    for (const difficulty of ['cadet', 'officer', 'commander', 'admiral'] as Difficulty[]) {
      const total = Array.from({ length: 40 }, (_, seed) =>
        runGame(difficulty, 1000 + seed, 50_000 + seed),
      ).reduce((sum, shots) => sum + shots, 0);
      averages.set(difficulty, total / 40);
    }
    expect(averages.get('cadet')!).toBeGreaterThan(averages.get('officer')!);
    expect(averages.get('officer')!).toBeGreaterThan(averages.get('commander')!);
    expect(averages.get('commander')!).toBeGreaterThan(averages.get('admiral')!);
    expect(averages.get('admiral')!).toBeLessThanOrEqual(averages.get('commander')! - 1.5);
    },
    60_000,
  );
});
