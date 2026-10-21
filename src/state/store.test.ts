import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty } from '../game/ai';
import { FLEET } from '../game/types';
import { useGame } from './store';

const firstUnknown = () => {
  const m = useGame.getState().match!;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (m.enemy.marks[y][x] === 'unknown') return { x, y };
  throw new Error('board exhausted');
};

const playToEnd = () => {
  for (let guard = 0; guard < 4000 && useGame.getState().phase === 'battle'; guard++) {
    const s = useGame.getState();
    if (!s.turnLock && !s.match?.winner) {
      s.aimAt(firstUnknown());
      useGame.getState().confirmFire();
    }
    vi.advanceTimersByTime(500);
  }
};

describe('game flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGame.getState().goMenu();
  });
  afterEach(() => vi.useRealTimers());

  it.each<Difficulty>(['cadet', 'officer', 'commander', 'admiral'])('plays %s from deploy to result without soft-locking', (d) => {
    const g = useGame.getState();
    g.startDeploy(d);
    useGame.getState().autoPlace();
    expect(useGame.getState().deploy.board.ships).toHaveLength(FLEET.length);
    useGame.getState().beginBattle();
    expect(useGame.getState().phase).toBe('battle');
    playToEnd();
    const s = useGame.getState();
    expect(s.phase).toBe('over');
    expect(s.stats).not.toBeNull();
    expect(s.story?.beats.length).toBeGreaterThan(0);
  });

  it('pause freezes the AI turn and resume continues it', () => {
    useGame.getState().startDeploy('officer');
    useGame.getState().autoPlace();
    useGame.getState().beginBattle();
    useGame.getState().aimAt({ x: 0, y: 0 });
    useGame.getState().confirmFire();
    useGame.getState().pauseGame();
    expect(useGame.getState().paused).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(useGame.getState().match!.log).toHaveLength(0);
    useGame.getState().aimAt({ x: 1, y: 1 });
    expect(useGame.getState().target).toEqual({ x: 0, y: 0 });
    useGame.getState().resumeGame();
    vi.advanceTimersByTime(6000);
    const s = useGame.getState();
    expect(s.match!.log.map((e) => e.by)).toEqual(['player', 'ai']);
    expect(s.turnLock).toBe(false);
  });

  it('quitting mid-turn drops pending timers so they never leak into the menu', () => {
    useGame.getState().startDeploy('cadet');
    useGame.getState().autoPlace();
    useGame.getState().beginBattle();
    useGame.getState().concede();
    useGame.getState().goMenu();
    vi.advanceTimersByTime(10_000);
    expect(useGame.getState().phase).toBe('menu');
  });

  it('rematch redeploys the same formation at the same difficulty', () => {
    useGame.getState().startDeploy('admiral');
    useGame.getState().autoPlace();
    const layout = useGame.getState().deploy.board.ships.map((s) => s.cells);
    useGame.getState().beginBattle();
    useGame.getState().concede();
    vi.advanceTimersByTime(3000);
    expect(useGame.getState().phase).toBe('over');
    expect(useGame.getState().story?.headline).toBe('Rolled back.');
    useGame.getState().rematch();
    const s = useGame.getState();
    expect(s.phase).toBe('deploy');
    expect(s.difficulty).toBe('admiral');
    expect(s.deploy.board.ships.map((x) => x.cells)).toEqual(layout);
    expect(s.deploy.board.marks.flat().every((m) => m === 'unknown')).toBe(true);
  });
});
