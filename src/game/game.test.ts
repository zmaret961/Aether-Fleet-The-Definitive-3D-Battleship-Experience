import { describe, expect, it } from 'vitest';
import {
  canPlace,
  createBoard,
  fireAt,
  placeShip,
  randomLayout,
} from './board';
import { FLEET, GRID_SIZE, shipSpec } from './types';
import type { Rng } from './types';
import { makeAI } from './ai';
import type { AIView, Difficulty } from './ai';
import { aiView, createMatch, shoot } from './engine';

const mulberry32 = (seed: number): Rng => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('board', () => {
  it('rejects overlapping and out-of-bounds placement', () => {
    const b = createBoard();
    expect(placeShip(b, shipSpec('carrier'), { x: 0, y: 0 }, 'h')).toBe(true);
    expect(canPlace(b, { x: 3, y: 0 }, 'h', 3)).toBe(false); // overlaps carrier
    expect(canPlace(b, { x: 8, y: 0 }, 'h', 3)).toBe(false); // out of bounds
    expect(canPlace(b, { x: 0, y: 9 }, 'v', 2)).toBe(false); // out of bounds
    expect(canPlace(b, { x: 1, y: 1 }, 'v', 5)).toBe(true);
  });

  it('places every ship in a random layout legally', () => {
    for (let seed = 0; seed < 50; seed++) {
      const b = randomLayout(mulberry32(seed));
      expect(b.ships).toHaveLength(FLEET.length);
      const cells = new Set<number>();
      for (const s of b.ships) {
        expect(s.cells).toHaveLength(s.spec.length);
        for (const c of s.cells) {
          expect(cells.has(c.y * GRID_SIZE + c.x)).toBe(false);
          cells.add(c.y * GRID_SIZE + c.x);
        }
      }
    }
  });

  it('reports hit, sunk and win correctly', () => {
    const b = createBoard();
    placeShip(b, shipSpec('destroyer'), { x: 0, y: 0 }, 'h');
    expect(fireAt(b, { x: 0, y: 0 }).kind).toBe('hit');
    expect(fireAt(b, { x: 0, y: 0 }).kind).toBe('already');
    expect(fireAt(b, { x: 1, y: 0 }).kind).toBe('win'); // destroyer was the only ship
    const ship = b.ships[0];
    expect(ship.sunk).toBe(true);
  });
});

describe('ai legality', () => {
  const runGame = (difficulty: Difficulty, seed: number) => {
    const rng = mulberry32(seed);
    const ai = makeAI(difficulty, rng);
    const m = createMatch(randomLayout(rng), randomLayout(rng));
    const seen = new Set<number>();
    let guard = 0;
    while (!m.winner && guard++ < 200) {
      const view: AIView = aiView(m);
      const c = ai.next(view);
      const key = c.y * GRID_SIZE + c.x;
      expect(seen.has(key)).toBe(false); // never repeats a shot
      seen.add(key);
      const ev = shoot(m, 'ai', c);
      expect(ev.outcome.kind).not.toBe('already');
      if (!m.winner) m.turn = 'player';
    }
    expect(m.winner).toBe('ai');
    return seen.size;
  };

  it.each(['cadet', 'officer', 'commander', 'admiral'] as Difficulty[])(
    '%s plays legally and always finishes',
    (d) => {
      for (let seed = 1; seed <= 10; seed++) runGame(d, seed * 7919);
    },
  );

  it('harder tiers sink fleets in fewer shots on average', () => {
    const shotsFor = (d: Difficulty) => {
      let total = 0;
      for (let seed = 0; seed < 12; seed++) total += runGame(d, seed * 104729 + 17);
      return total / 12;
    };
    const cadet = shotsFor('cadet');
    const commander = shotsFor('commander');
    const admiral = shotsFor('admiral');
    expect(commander).toBeLessThan(cadet);
    expect(admiral).toBeLessThan(cadet);
    expect(admiral).toBeLessThanOrEqual(commander + 4);
  });
});

describe('engine', () => {
  it('alternates hits only on enemy board and detects winner', () => {
    const enemy = createBoard();
    placeShip(enemy, shipSpec('destroyer'), { x: 5, y: 5 }, 'h');
    const m = createMatch(createBoard(), enemy);
    shoot(m, 'player', { x: 5, y: 5 });
    shoot(m, 'player', { x: 6, y: 5 });
    expect(m.winner).toBe('player');
    expect(enemy.marks[5][5]).toBe('hit');
  });

  it('exposes only legal information in aiView', () => {
    const rng = mulberry32(3);
    const player = randomLayout(rng);
    const m = createMatch(player, createBoard());
    const view = aiView(m);
    expect(view.remainingLengths).toEqual([5, 4, 3, 3, 2]);
    const totalHit = view.marks.flat().filter((x) => x === 'hit').length;
    expect(totalHit).toBe(0);
  });
});
