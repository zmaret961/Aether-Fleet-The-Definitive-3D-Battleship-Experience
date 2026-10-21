import { describe, expect, it } from 'vitest';
import { createBoard, placeShip } from './board';
import { createMatch, shoot } from './engine';
import { buildStory } from './story';
import { FLEET } from './types';

const fleetBoard = () => {
  const b = createBoard();
  FLEET.forEach((spec, row) => placeShip(b, spec, { x: 0, y: row * 2 }, 'h'));
  return b;
};

const enemyCells = (m: ReturnType<typeof createMatch>) => m.enemy.ships.flatMap((s) => s.cells);

describe('match story', () => {
  it('tells a flawless win with first blood, every sink and a final ticket', () => {
    const m = createMatch(fleetBoard(), fleetBoard());
    for (const [turn, c] of enemyCells(m).entries()) {
      shoot(m, 'player', c);
      if (!m.winner) shoot(m, 'ai', { x: turn < 10 ? 9 : 8, y: turn % 10 });
    }
    const story = buildStory(m);
    expect(m.winner).toBe('player');
    expect(story.headline).toBe('Flawless deploy.');
    expect(story.beats[0].title).toBe('First green build');
    expect(story.beats.at(-1)?.title).toMatch(/^Final ticket closed/);
    expect(story.beats.length).toBeLessThanOrEqual(7);
    expect(story.enemyAfloat).toBe(0);
    expect(story.bestHitStreak).toBe(17);
  });

  it('reports a near miss loss and the persistence beat', () => {
    const m = createMatch(fleetBoard(), fleetBoard());
    const misses = Array.from({ length: 8 }, (_, i) => ({ x: 9, y: i }));
    const enemy = enemyCells(m).slice(0, -2); // leave the destroyer afloat
    const playerCells = m.player.ships.flatMap((s) => s.cells);
    const shots = [...misses, ...enemy];
    const trailingMisses = [
      ...Array.from({ length: 10 }, (_, y) => ({ x: 8, y })),
      ...Array.from({ length: 7 }, (_, y) => ({ x: 7, y })),
    ];
    for (let i = 0; !m.winner; i++) {
      shoot(m, 'player', shots[i] ?? trailingMisses[i - shots.length]);
      const aiMiss = { x: 6 + (i % 4), y: Math.floor(i / 4) };
      if (!m.winner) shoot(m, 'ai', i < shots.length ? aiMiss : playerCells[i - shots.length]);
    }
    const story = buildStory(m);
    expect(m.winner).toBe('ai');
    expect(story.headline).toBe('One ticket from green.');
    expect(story.beats.some((b) => b.title === 'Persistence pays')).toBe(true);
    expect(story.ai.hits).toBe(17);
  });

  it('marks conceded matches as a rollback', () => {
    const m = createMatch(fleetBoard(), fleetBoard());
    m.winner = 'ai';
    const story = buildStory(m, { conceded: true });
    expect(story.headline).toBe('Rolled back.');
    expect(story.beats.at(-1)?.title).toBe('Rollback requested');
  });
});
