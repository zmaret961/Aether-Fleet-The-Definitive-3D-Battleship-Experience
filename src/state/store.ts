import { create } from 'zustand';
import { audio } from '../audio/engine';
import { makeAI } from '../game/ai';
import type { AIPlayer, Difficulty } from '../game/ai';
import {
  canPlace,
  createBoard,
  placeShip,
  randomLayout,
  removeShip,
} from '../game/board';
import type { Board } from '../game/board';
import {
  aiView,
  createMatch,
  matchStats,
  shoot,
} from '../game/engine';
import type { Match, MatchStats } from '../game/engine';
import { FLEET, shipSpec } from '../game/types';
import type { Coord, Orientation, ShipSpec } from '../game/types';
import { fx } from './fx';

export type Phase = 'menu' | 'howto' | 'difficulty' | 'deploy' | 'battle' | 'over';
export type BoardView = 'enemy' | 'player';
export type PerfMode = 'auto' | 'high' | 'low';

export interface Settings {
  volume: number;
  muted: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  perfMode: PerfMode;
}

interface PersistedRecord {
  wins: number;
  losses: number;
}

type Records = Partial<Record<Difficulty, PersistedRecord>>;

const RECORDS_KEY = 'aether-fleet:records';
const SETTINGS_KEY = 'aether-fleet:settings';

const loadRecords = (): Records => {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}') as Records;
  } catch {
    return {};
  }
};

const loadSettings = (): Settings => {
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const defaults: Settings = {
    volume: 0.8,
    muted: false,
    reducedMotion: prefersReduced,
    highContrast: false,
    perfMode: 'auto',
  };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return defaults;
  }
};

interface DeployState {
  board: Board;
  selected: string | null;
  orientation: Orientation;
}

interface GameStore {
  phase: Phase;
  difficulty: Difficulty;
  match: Match | null;
  matchVersion: number;
  ai: AIPlayer | null;
  aiThinking: boolean;
  turnLock: boolean; // blocks input during an animation/AI turn
  boardView: BoardView;
  deploy: DeployState;
  target: Coord | null; // pending firing solution
  lastOutcome: { by: 'player' | 'ai'; text: string; seq: number } | null;
  stats: MatchStats | null;
  records: Records;
  settings: Settings;
  settingsOpen: boolean;

  goMenu: () => void;
  goHowTo: () => void;
  goDifficulty: () => void;
  startDeploy: (d: Difficulty) => void;
  selectShip: (id: string) => void;
  rotateDeploy: () => void;
  tryPlace: (origin: Coord) => void;
  pickupShip: (shipId: string) => void;
  autoPlace: () => void;
  resetDeploy: () => void;
  beginBattle: () => void;
  aimAt: (c: Coord) => void;
  confirmFire: () => void;
  setBoardView: (v: BoardView) => void;
  playAgain: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean) => void;
}

let aiTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameStore>((set, get) => {
  const persistSettings = (s: Settings) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  };

  const persistRecords = (r: Records) => {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
    } catch {
      /* private mode */
    }
  };

  const finishIfOver = (m: Match) => {
    if (!m.winner) return;
    const stats = matchStats(m, get().difficulty);
    const rec = loadRecords();
    const cur = rec[get().difficulty] ?? { wins: 0, losses: 0 };
    if (m.winner === 'player') cur.wins += 1;
    else cur.losses += 1;
    rec[get().difficulty] = cur;
    persistRecords(rec);
    audio[m.winner === 'player' ? 'victory' : 'defeat']();
    setTimeout(() => set({ phase: 'over', stats, records: rec }), 1800);
  };

  const resolvePlayerShot = (c: Coord) => {
    const { match } = get();
    if (!match) return;
    const ev = shoot(match, 'player', c);
    if (ev.outcome.kind === 'already') return;

    if (ev.outcome.kind === 'miss') {
      audio.miss();
      fx.emit({ type: 'splash', coord: c });
      fx.emit({ type: 'marker', coord: c, outcome: 'miss' });
      set({ lastOutcome: { by: 'player', text: 'Miss', seq: match.log.length } });
    } else {
      audio.hit();
      fx.emit({ type: 'explosion', coord: c });
      fx.emit({ type: 'marker', coord: c, outcome: 'hit' });
      const shipName = 'shipId' in ev.outcome ? shipSpec(ev.outcome.shipId).name : '';
      if (ev.outcome.kind === 'sunk' || ev.outcome.kind === 'win') {
        setTimeout(() => {
          audio.sink();
          fx.emit({ type: 'sink', coord: c });
        }, 450);
        set({
          lastOutcome: {
            by: 'player',
            text: `Enemy ${shipName} sunk`,
            seq: match.log.length,
          },
        });
      } else {
        set({ lastOutcome: { by: 'player', text: 'Direct hit', seq: match.log.length } });
      }
    }

    set((s) => ({ matchVersion: s.matchVersion + 1, target: null }));
    if (match.winner) {
      finishIfOver(match);
      return;
    }
    match.turn = 'ai';
    set({ aiThinking: true, turnLock: true });
    scheduleAI();
  };

  const scheduleAI = () => {
    if (aiTimer) clearTimeout(aiTimer);
    const delay = 900 + Math.random() * 700;
    aiTimer = setTimeout(() => {
      const { match, ai } = get();
      if (!match || !ai || match.winner) return;
      const c = ai.next(aiView(match));
      const ev = shoot(match, 'ai', c);
      fx.emit({ type: 'sonar', coord: c });

      setTimeout(() => {
        if (ev.outcome.kind === 'miss') {
          audio.miss();
          fx.emit({ type: 'splash', coord: c, big: false });
          fx.emit({ type: 'marker', coord: c, outcome: 'miss' });
          set({ lastOutcome: { by: 'ai', text: 'Enemy missed', seq: match.log.length } });
        } else {
          audio.hit();
          fx.emit({ type: 'explosion', coord: c });
          fx.emit({ type: 'marker', coord: c, outcome: 'hit' });
          const shipName = 'shipId' in ev.outcome ? shipSpec(ev.outcome.shipId).name : '';
          if (ev.outcome.kind === 'sunk' || ev.outcome.kind === 'win') {
            setTimeout(() => audio.sink(), 450);
            set({
              lastOutcome: { by: 'ai', text: `${shipName} sunk`, seq: match.log.length },
            });
          } else {
            set({ lastOutcome: { by: 'ai', text: 'Hull breach', seq: match.log.length } });
          }
        }
        set((s) => ({
          matchVersion: s.matchVersion + 1,
          aiThinking: false,
          turnLock: false,
        }));
        if (match.winner) {
          finishIfOver(match);
        } else {
          match.turn = 'player';
        }
      }, 420);
    }, delay);
  };

  return {
    phase: 'menu',
    difficulty: 'officer',
    match: null,
    matchVersion: 0,
    ai: null,
    aiThinking: false,
    turnLock: false,
    boardView: 'enemy',
    deploy: { board: createBoard(), selected: null, orientation: 'h' },
    target: null,
    lastOutcome: null,
    stats: null,
    records: loadRecords(),
    settings: loadSettings(),
    settingsOpen: false,

    goMenu: () => {
      if (aiTimer) clearTimeout(aiTimer);
      set({ phase: 'menu', match: null, stats: null, aiThinking: false, turnLock: false, target: null });
    },
    goHowTo: () => set({ phase: 'howto' }),
    goDifficulty: () => set({ phase: 'difficulty' }),

    startDeploy: (d) => {
      audio.click();
      set({
        difficulty: d,
        phase: 'deploy',
        deploy: { board: createBoard(), selected: null, orientation: 'h' },
        boardView: 'enemy',
      });
    },

    selectShip: (id) => {
      audio.click();
      set((s) => ({ deploy: { ...s.deploy, selected: id } }));
    },

    rotateDeploy: () => {
      audio.rotate();
      set((s) => ({ deploy: { ...s.deploy, orientation: s.deploy.orientation === 'h' ? 'v' : 'h' } }));
    },

    tryPlace: (origin) => {
      const { deploy } = get();
      if (!deploy.selected) return;
      const spec: ShipSpec = shipSpec(deploy.selected);
      const next = { ...deploy, board: deploy.board };
      if (placeShip(deploy.board, spec, origin, deploy.orientation)) {
        audio.place();
        set({ deploy: { ...next, selected: null } });
      } else {
        audio.error();
      }
    },

    pickupShip: (shipId) => {
      const { deploy } = get();
      removeShip(deploy.board, shipId);
      audio.click();
      set((s) => ({
        deploy: { ...s.deploy, board: { ...deploy.board }, selected: shipId },
        matchVersion: s.matchVersion + 1,
      }));
    },

    autoPlace: () => {
      const { deploy } = get();
      const placedIds = new Set(deploy.board.ships.map((s) => s.spec.id));
      const remaining = FLEET.filter((f) => !placedIds.has(f.id)).sort((a, b) => b.length - a.length);
      for (const spec of remaining) {
        let tries = 0;
        while (tries++ < 500) {
          const origin = { x: Math.floor(Math.random() * 10), y: Math.floor(Math.random() * 10) };
          const o: Orientation = Math.random() < 0.5 ? 'h' : 'v';
          if (canPlace(deploy.board, origin, o, spec.length)) {
            placeShip(deploy.board, spec, origin, o);
            break;
          }
        }
      }
      audio.place();
      set((s) => ({
        deploy: { ...s.deploy, board: { ...deploy.board }, selected: null },
        matchVersion: s.matchVersion + 1,
      }));
    },

    resetDeploy: () => {
      audio.click();
      set((s) => ({
        deploy: { board: createBoard(), selected: null, orientation: s.deploy.orientation },
        matchVersion: s.matchVersion + 1,
      }));
    },

    beginBattle: () => {
      const { deploy, difficulty } = get();
      if (deploy.board.ships.length !== FLEET.length) return;
      const match = createMatch(deploy.board, randomLayout(Math.random));
      set({
        match,
        ai: makeAI(difficulty),
        phase: 'battle',
        boardView: 'enemy',
        matchVersion: 0,
        aiThinking: false,
        turnLock: false,
        lastOutcome: null,
      });
      audio.startAmbient();
      audio.setAmbientLevel(0.2);
    },

    aimAt: (c) => {
      const s = get();
      if (s.phase !== 'battle' || !s.match || s.turnLock || s.match.winner) return;
      const marks = s.match.enemy.marks;
      if (marks[c.y][c.x] !== 'unknown') return;
      audio.sonarPulse();
      fx.emit({ type: 'sonar', coord: c });
      set({ target: c });
    },

    confirmFire: () => {
      const s = get();
      if (!s.target || s.turnLock) return;
      set({ turnLock: true });
      audio.fire();
      setTimeout(() => {
        resolvePlayerShot(s.target!);
        set({ turnLock: s.match?.winner ? true : false });
      }, 380);
    },

    setBoardView: (v) => {
      audio.click();
      set({ boardView: v });
    },

    playAgain: () => {
      audio.click();
      if (aiTimer) clearTimeout(aiTimer);
      set({ phase: 'difficulty', match: null, stats: null });
    },

    updateSettings: (patch) => {
      const s = { ...get().settings, ...patch };
      audio.setVolume(s.volume);
      audio.setMuted(s.muted);
      persistSettings(s);
      set({ settings: s });
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
  };
});

export const placedCount = (s: GameStore) => s.deploy.board.ships.length;
