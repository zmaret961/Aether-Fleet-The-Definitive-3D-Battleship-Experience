import { describe, expect, it } from 'vitest';
import { AdmiralAI, DIFFICULTY_INFO, TIER_PERSONALITY, admiralBelief, pickTaunt, thinkDelayMs } from './ai';
import type { AIView, Difficulty } from './ai';
import { HUMAN_ARCHETYPES, humanLikeLayout } from './humanLayouts';
import {
  GENERIC_HUMAN_PRIOR,
  MEMORY_DECAY,
  UNIFORM_PRIOR,
  emptyPlacementMemory,
  parsePlacementMemory,
  placementTell,
  priorFromMemory,
  recordPlacement,
} from './prior';
import { createRng } from './rng';
import { FLEET, GRID_SIZE } from './types';
import type { Coord } from './types';

const view = (remainingLengths: number[]): AIView => ({
  marks: Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => 'unknown' as const)),
  sunkCells: Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => false)),
  remainingLengths,
});

const row = (y: number, x0: number, length: number): Coord[] =>
  Array.from({ length }, (_, i) => ({ x: x0 + i, y }));

/** A tidy, all-horizontal, edge-hugging fleet: the kind of habit the Admiral should learn. */
const habitFleet = (): Coord[][] => FLEET.map((spec, i) => row(i * 2, 0, spec.length));

describe('placement memory', () => {
  it('records decayed history and survives a JSON round-trip', () => {
    const one = recordPlacement(null, habitFleet());
    expect(one.games).toBe(1);
    expect(one.horizontal).toBe(FLEET.length);
    const two = recordPlacement(one, habitFleet());
    expect(two.games).toBeCloseTo(1 + MEMORY_DECAY);
    expect(one.games).toBe(1); // pure: input untouched
    expect(parsePlacementMemory(JSON.parse(JSON.stringify(two)))).toEqual(two);
  });

  it('rejects corrupted or foreign localStorage payloads', () => {
    expect(parsePlacementMemory(null)).toBeNull();
    expect(parsePlacementMemory('nope')).toBeNull();
    expect(parsePlacementMemory({ ...emptyPlacementMemory(), cells: [1, 2, 3] })).toBeNull();
    expect(parsePlacementMemory({ ...emptyPlacementMemory(), games: Number.NaN })).toBeNull();
  });

  it('learns orientation, edge and regional habits from this player', () => {
    expect(priorFromMemory(null)).toBe(GENERIC_HUMAN_PRIOR);
    let memory = null as ReturnType<typeof recordPlacement> | null;
    for (let g = 0; g < 4; g++) memory = recordPlacement(memory, habitFleet());
    const prior = priorFromMemory(memory);
    expect(prior.horizontal).toBeGreaterThan(prior.vertical);
    expect(prior.edge).toBeGreaterThan(prior.interior);
    // the top-left is hot, the bottom-right is cold
    expect(prior.cell[0]).toBeGreaterThan(prior.cell[GRID_SIZE * GRID_SIZE - 1]);
    expect(placementTell(memory)).toMatch(/\S/);
  });
});

describe('Admiral posterior', () => {
  it('is an exact, normalised posterior in the endgame', () => {
    const v = view([2]);
    for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) v.marks[y][x] = 'miss';
    // only two legal homes for the destroyer: (4,4)-(5,4) or (4,4)-(4,5)
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [4, 5],
    ])
      v.marks[y][x] = 'unknown';
    const belief = admiralBelief(v, UNIFORM_PRIOR)!;
    expect(belief.mode).toBe('endgame');
    expect(belief.map[4][4]).toBeCloseTo(1);
    expect(belief.map[4][5]).toBeCloseTo(0.5);
    expect(belief.map[5][4]).toBeCloseTo(0.5);
  });

  it('eliminates ship lengths that no longer fit after sinks', () => {
    const v = view([5]);
    // carve the ocean so the only 5-long run is row 9; a 2-gap elsewhere cannot host the carrier
    for (let y = 0; y < GRID_SIZE - 1; y++) for (let x = 0; x < GRID_SIZE; x++) v.marks[y][x] = (x + y) % 2 ? 'miss' : 'unknown';
    for (let x = 0; x < GRID_SIZE; x++) v.marks[GRID_SIZE - 1][x] = x === 0 ? 'miss' : 'unknown';
    const ai = new AdmiralAI(createRng(1));
    const shot = ai.next(v);
    expect(shot.y).toBe(GRID_SIZE - 1);
    expect(ai.lastDecision?.mode).toBe('endgame');
    // cells (5..5) are in every legal carrier placement on cols 1..9 → central columns are certain
    expect([5]).toContain(shot.x);
  });

  it('finishes a wounded ship along its known axis', () => {
    const v = view([5, 4, 3, 3, 2]);
    v.marks[5][5] = 'hit';
    v.marks[5][6] = 'hit';
    const ai = new AdmiralAI(createRng(3));
    const shot = ai.next(v);
    expect(shot.y).toBe(5);
    expect([4, 7]).toContain(shot.x);
  });
});

describe('human-like layouts', () => {
  it('always produces a complete, legal fleet', () => {
    const rng = createRng(11);
    for (const style of HUMAN_ARCHETYPES)
      for (let i = 0; i < 20; i++) {
        const board = humanLikeLayout(rng, style);
        expect(board.ships).toHaveLength(FLEET.length);
        const seen = new Set<string>();
        for (const ship of board.ships)
          for (const c of ship.cells) {
            expect(c.x >= 0 && c.y >= 0 && c.x < GRID_SIZE && c.y < GRID_SIZE).toBe(true);
            const k = `${c.x},${c.y}`;
            expect(seen.has(k)).toBe(false);
            seen.add(k);
          }
      }
  });
});

describe('tier personality', () => {
  const tiers = Object.keys(DIFFICULTY_INFO) as Difficulty[];

  it('gives every tier pacing and a voice', () => {
    for (const d of tiers) {
      const p = TIER_PERSONALITY[d];
      expect(p.thinkMs[0]).toBeGreaterThan(0);
      expect(p.thinkMs[1]).toBeGreaterThan(p.thinkMs[0]);
      for (const pool of Object.values(p.taunts)) expect(pool.length).toBeGreaterThan(0);
      expect(pickTaunt(d, 'sink', createRng(2))).toMatch(/\S/);
    }
  });

  it('keeps think delays inside the tier window and snaps on certain shots', () => {
    const rng = createRng(5);
    for (const d of tiers) {
      const [lo, hi] = TIER_PERSONALITY[d].thinkMs;
      for (let i = 0; i < 50; i++) {
        const ms = thinkDelayMs(d, rng);
        expect(ms).toBeGreaterThanOrEqual(lo);
        expect(ms).toBeLessThanOrEqual(hi);
      }
    }
    const certain = thinkDelayMs('admiral', rng, { coord: { x: 0, y: 0 }, mode: 'endgame', confidence: 1 });
    expect(certain).toBeLessThan(TIER_PERSONALITY.admiral.thinkMs[0]);
  });

  it('ranks the tiers by measured strength', () => {
    const shots = tiers.map((d) => DIFFICULTY_INFO[d].avgShots);
    expect([...shots].sort((a, b) => b - a)).toEqual(shots);
    expect(tiers.map((d) => DIFFICULTY_INFO[d].rank)).toEqual([1, 2, 3, 4]);
    expect(DIFFICULTY_INFO.admiral.vsReturning).toBeLessThan(DIFFICULTY_INFO.commander.vsReturning - 2);
  });
});
