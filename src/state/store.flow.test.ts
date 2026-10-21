import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty } from '../game/ai';
import { storyToText } from '../game/story';
import { pendingTimerCount, RESULT_HOLD_MS, useGame } from './store';

const DIFFS: Difficulty[] = ['cadet', 'officer', 'commander', 'admiral'];
const g = () => useGame.getState();

const firstUnknown = () => {
  const m = g().match!;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (m.enemy.marks[y][x] === 'unknown') return { x, y };
  throw new Error('board exhausted');
};
const enemyShipCells = () => g().match!.enemy.ships.flatMap((s) => s.cells);

/** Advances fake time in small steps, firing whenever the store unlocks input. */
const playUntilDecided = (pick: () => { x: number; y: number }, stepMs = 100) => {
  let elapsed = 0;
  for (let guard = 0; guard < 20_000 && g().phase === 'battle' && !g().match!.winner; guard++) {
    const s = g();
    if (!s.turnLock) {
      s.aimAt(pick());
      g().confirmFire();
    }
    vi.advanceTimersByTime(stepMs);
    elapsed += stepMs;
  }
  return elapsed;
};

const deployAndBegin = (d: Difficulty) => {
  g().startDeploy(d);
  g().autoPlace();
  g().beginBattle();
  expect(g().phase).toBe('battle');
};

const expectNoTimers = () => {
  expect(pendingTimerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
};

describe('full-match lifecycle (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    g().goMenu();
    vi.clearAllTimers();
  });
  afterEach(() => {
    g().goMenu();
    vi.useRealTimers();
  });

  it.each(DIFFS)('%s: win -> finale hold -> report -> rematch -> second report, then quit -> new game, with no leaked timers', (d) => {
    // game 1: win by aiming at known ship cells
    deployAndBegin(d);
    let targets = enemyShipCells();
    const elapsed1 = playUntilDecided(() => targets.find((c) => g().match!.enemy.marks[c.y][c.x] === 'unknown')!);
    expect(g().match!.winner).toBe('player');

    // the boss finale holds the report for exactly RESULT_HOLD_MS
    expect(g().resultPending).toBe(true);
    expect(g().phase).toBe('battle');
    vi.advanceTimersByTime(RESULT_HOLD_MS - 150); // the deciding step may already have used up to 100ms
    expect(g().phase).toBe('battle');
    vi.advanceTimersByTime(200);
    expect(g().phase).toBe('over');
    expect(g().resultPending).toBe(false);
    expectNoTimers();

    // mission clock: real battle time (fake clock), not the report delay
    const dur1 = g().stats!.durationSec;
    expect(Math.abs(dur1 - elapsed1 / 1000)).toBeLessThanOrEqual(1.5);
    expect(dur1).toBeGreaterThan(17 * 2); // 17 shots each need missile + AI turn

    // rematch -> second result (lose by firing at water only, skip the finale)
    g().rematch();
    expectNoTimers();
    expect(g().phase).toBe('deploy');
    g().beginBattle();
    playUntilDecided(firstUnknown, 200);
    expect(g().match!.winner).not.toBeNull();
    g().revealResult();
    expect(g().phase).toBe('over');
    expect(g().story?.beats.length).toBeGreaterThan(0);
    expectNoTimers();
    const recs = g().records[d]!;
    expect(recs.wins + recs.losses).toBeGreaterThanOrEqual(2);

    // quit mid-battle (AI turn in flight) -> menu -> brand-new game still plays
    g().rematch();
    g().beginBattle();
    g().aimAt(firstUnknown());
    g().confirmFire();
    vi.advanceTimersByTime(900);
    expect(pendingTimerCount()).toBeGreaterThan(0);
    g().goMenu();
    expectNoTimers();
    vi.advanceTimersByTime(30_000);
    expect(g().phase).toBe('menu');
    expect(g().match).toBeNull();

    deployAndBegin(d);
    targets = enemyShipCells();
    playUntilDecided(() => targets.find((c) => g().match!.enemy.marks[c.y][c.x] === 'unknown')!);
    vi.advanceTimersByTime(RESULT_HOLD_MS);
    expect(g().phase).toBe('over');
    expectNoTimers();
  });

  it('paused time never counts toward the mission clock, and pause cannot start during the finale', () => {
    deployAndBegin('officer');
    vi.advanceTimersByTime(10_000);
    g().pauseGame();
    vi.advanceTimersByTime(120_000);
    g().resumeGame();
    vi.advanceTimersByTime(5_000);
    g().concede();
    expect(g().resultPending).toBe(true);
    g().pauseGame();
    expect(g().paused).toBe(false);
    vi.advanceTimersByTime(RESULT_HOLD_MS);
    expect(g().phase).toBe('over');
    expect(g().stats!.durationSec).toBe(15);
    expectNoTimers();
  });

  it('skipping the finale is idempotent and quitting during it drops the reveal', () => {
    deployAndBegin('cadet');
    g().concede();
    g().goMenu();
    expectNoTimers();
    vi.advanceTimersByTime(RESULT_HOLD_MS * 2);
    expect(g().phase).toBe('menu');
    g().revealResult();
    expect(g().phase).toBe('menu');

    deployAndBegin('cadet');
    g().concede();
    g().revealResult();
    g().revealResult();
    expect(g().phase).toBe('over');
    expectNoTimers();
  });

  it('share text carries the report, the final grid and the Monolith quote', () => {
    deployAndBegin('commander');
    const targets = enemyShipCells();
    playUntilDecided(() => targets.find((c) => g().match!.enemy.marks[c.y][c.x] === 'unknown')!);
    g().revealResult();
    const s = g();
    const text = storyToText(s.story!, {
      commanderName: 'Scott Wu',
      difficultyLabel: 'CVE Backlog',
      duration: '1:23',
      shots: s.stats!.shots,
      accuracyPct: s.stats!.accuracyPct,
      shipsSunk: s.stats!.shipsSunk,
      marks: s.match!.enemy.marks,
    });
    expect(text).toContain('AETHER FLEET · FIELD REPORT');
    expect(text).toContain('Commander Scott Wu vs CVE Backlog · 1:23 mission');
    expect(text).toContain('5/5 tickets closed');
    expect(text.match(/X/g)?.length).toBeGreaterThanOrEqual(17);
    expect(text).toContain(`LEGACY-MONOLITH> ${s.story!.monolithQuote}`);
  });
});
