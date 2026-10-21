import { create } from 'zustand';
import { audio } from '../audio/engine';
import { makeAI, thinkDelayMs } from '../game/ai';
import { parsePlacementMemory, recordPlacement } from '../game/prior';
import type { PlacementMemory } from '../game/prior';
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
import { buildStory } from '../game/story';
import type { MatchStory } from '../game/story';
import { COMMANDERS, ENEMY_FLEET_NAMES, FLEET, shipSpec } from '../game/types';
import type { CommanderId } from '../game/types';
import type { Coord, Orientation, ShipSpec } from '../game/types';
import { fx, MISSILE_FLIGHT_MS } from './fx';

export type Phase = 'menu' | 'howto' | 'commander' | 'difficulty' | 'deploy' | 'battle' | 'over';
export type BoardView = 'enemy' | 'player';
export type PerfMode = 'auto' | 'high' | 'low';

export interface Settings {
  volume: number;
  musicVolume: number;
  sfxVolume: number;
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
const COMMANDER_KEY = 'aether-fleet:commander';
const PLACEMENT_MEMORY_KEY = 'aether-fleet:placement-memory';

/** The Admiral studies how this player deploys, across sessions. */
const loadPlacementMemory = (): PlacementMemory | null => {
  try {
    return parsePlacementMemory(JSON.parse(localStorage.getItem(PLACEMENT_MEMORY_KEY) ?? 'null'));
  } catch {
    return null;
  }
};

const persistPlacementMemory = (memory: PlacementMemory) => {
  try {
    localStorage.setItem(PLACEMENT_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* private mode */
  }
};

const loadCommander = (): CommanderId => {
  try {
    const saved = localStorage.getItem(COMMANDER_KEY);
    if (COMMANDERS.some((commander) => commander.id === saved)) return saved as CommanderId;
  } catch {
    /* private mode */
  }
  return 'scott-wu';
};

const loadRecords = (): Records => {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}') as Records;
  } catch {
    return {};
  }
};

const level = (v: unknown, fallback: number): number =>
  Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(1, Math.max(0, Number(v))) : fallback;

const loadSettings = (): Settings => {
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const defaults: Settings = {
    volume: 0.8,
    musicVolume: 0.8,
    sfxVolume: 0.9,
    muted: false,
    reducedMotion: prefersReduced,
    highContrast: false,
    perfMode: 'auto',
  };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    const merged = { ...defaults, ...raw };
    return {
      volume: level(merged.volume, defaults.volume),
      musicVolume: level(merged.musicVolume, defaults.musicVolume),
      sfxVolume: level(merged.sfxVolume, defaults.sfxVolume),
      muted: Boolean(merged.muted),
      reducedMotion: Boolean(merged.reducedMotion),
      highContrast: Boolean(merged.highContrast),
      perfMode: (['auto', 'high', 'low'] as const).includes(merged.perfMode) ? merged.perfMode : 'auto',
    };
  } catch {
    return defaults;
  }
};

interface SavedPlacement {
  id: string;
  origin: Coord;
  orientation: Orientation;
}

const layoutOf = (board: Board): SavedPlacement[] =>
  board.ships.map((ship) => ({
    id: ship.spec.id,
    origin: ship.cells[0],
    orientation: ship.cells.length > 1 && ship.cells[1].x !== ship.cells[0].x ? 'h' : 'v',
  }));

const boardFromLayout = (layout: SavedPlacement[]): Board => {
  const board = createBoard();
  for (const p of layout) placeShip(board, shipSpec(p.id), p.origin, p.orientation);
  return board;
};

const cellName = (c: Coord) => `${String.fromCharCode(65 + c.x)}${c.y + 1}`;

interface DeployState {
  board: Board;
  selected: string | null;
  orientation: Orientation;
}

interface GameStore {
  phase: Phase;
  difficulty: Difficulty;
  commanderId: CommanderId;
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
  story: MatchStory | null;
  /** battle is frozen: AI timers parked, input ignored */
  paused: boolean;
  conceded: boolean;
  lastLayout: SavedPlacement[] | null;
  records: Records;
  settings: Settings;
  settingsOpen: boolean;

  goMenu: () => void;
  goHowTo: () => void;
  goDifficulty: () => void;
  goCommander: () => void;
  selectCommander: (id: CommanderId) => void;
  concede: () => void;
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
  rematch: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  togglePause: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean) => void;
}

/**
 * Pausable timers. Every delayed step of a match goes through `later` so a
 * pause can freeze the turn mid-flight and a quit can drop it entirely.
 */
interface PendingTimer {
  id: number;
  fn: () => void;
  handle: ReturnType<typeof setTimeout> | null;
  due: number;
  remaining: number;
}
const timers = new Map<number, PendingTimer>();
let nextTimerId = 1;
let timersFrozen = false;
let pausedAt: number | null = null;

const armTimer = (t: PendingTimer) => {
  t.due = performance.now() + t.remaining;
  t.handle = setTimeout(() => {
    timers.delete(t.id);
    t.fn();
  }, t.remaining);
};
const later = (fn: () => void, ms: number) => {
  const t: PendingTimer = { id: nextTimerId++, fn, handle: null, due: 0, remaining: ms };
  timers.set(t.id, t);
  if (!timersFrozen) armTimer(t);
};
const freezeTimers = () => {
  timersFrozen = true;
  timers.forEach((t) => {
    if (!t.handle) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(0, t.due - performance.now());
  });
};
const thawTimers = () => {
  timersFrozen = false;
  timers.forEach((t) => {
    if (!t.handle) armTimer(t);
  });
};
const cancelTimers = () => {
  timers.forEach((t) => t.handle && clearTimeout(t.handle));
  timers.clear();
  timersFrozen = false;
  pausedAt = null;
};

const AI_REVIEW_MS = 1150;
const RESULT_DELAY_MS = 1800;

export const useGame = create<GameStore>((set, get) => {
  const initialSettings = loadSettings();
  audio.setVolume(initialSettings.volume);
  audio.setMusicVolume(initialSettings.musicVolume);
  audio.setSfxVolume(initialSettings.sfxVolume);
  audio.setMuted(initialSettings.muted);

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
    const story = buildStory(m, { conceded: get().conceded, seed: m.startedAt });
    const rec = loadRecords();
    const cur = rec[get().difficulty] ?? { wins: 0, losses: 0 };
    if (m.winner === 'player') cur.wins += 1;
    else cur.losses += 1;
    rec[get().difficulty] = cur;
    persistRecords(rec);
    audio[m.winner === 'player' ? 'victory' : 'defeat']();
    set({ records: rec });
    later(() => set({ phase: 'over', stats, story, target: null }), RESULT_DELAY_MS);
  };

  const resolvePlayerShot = (c: Coord) => {
    const { match } = get();
    if (!match || match.winner) return;
    const ev = shoot(match, 'player', c);
    if (ev.outcome.kind === 'already') {
      set({ turnLock: false });
      return;
    }

    if (ev.outcome.kind === 'miss') {
      fx.emit({ type: 'splash', coord: c, side: 'enemy' });
      fx.emit({ type: 'marker', coord: c, outcome: 'miss', side: 'enemy' });
      set({ lastOutcome: { by: 'player', text: 'CI failed', seq: match.log.length } });
    } else {
      fx.emit({ type: 'explosion', coord: c, side: 'enemy' });
      fx.emit({ type: 'marker', coord: c, outcome: 'hit', side: 'enemy' });
      const shipName = 'shipId' in ev.outcome ? ENEMY_FLEET_NAMES[ev.outcome.shipId] : '';
      if (ev.outcome.kind === 'sunk' || ev.outcome.kind === 'win') {
        later(() => {
          fx.emit({ type: 'sink', coord: c, side: 'enemy' });
        }, 450);
        set({
          lastOutcome: {
            by: 'player',
            text: `Ticket closed: ${shipName}`,
            seq: match.log.length,
          },
        });
      } else {
        set({ lastOutcome: { by: 'player', text: 'PR merged', seq: match.log.length } });
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
    const { match: current, ai: currentAI, difficulty } = get();
    if (!current || !currentAI || current.winner) return;
    // Decide now (the board cannot change during Legacy's turn); pace the shot by the tier's personality.
    const c = currentAI.next(aiView(current));
    const delay = thinkDelayMs(difficulty, Math.random, currentAI.lastDecision);
    later(() => {
      const { match, ai } = get();
      if (!match || match !== current || ai !== currentAI || match.winner) return;
      fx.emit({ type: 'missile', coord: c, side: 'player' });
      later(() => {
        if (get().phase !== 'battle' || get().match !== match || match.winner) return;
        const ev = shoot(match, 'ai', c);
        if (ev.outcome.kind === 'miss') {
          fx.emit({ type: 'splash', coord: c, big: false, side: 'player' });
          fx.emit({ type: 'marker', coord: c, outcome: 'miss', side: 'player' });
          set({ lastOutcome: { by: 'ai', text: "Legacy's build failed", seq: match.log.length } });
        } else {
          fx.emit({ type: 'explosion', coord: c, side: 'player' });
          fx.emit({ type: 'marker', coord: c, outcome: 'hit', side: 'player' });
          const shipName = 'shipId' in ev.outcome ? shipSpec(ev.outcome.shipId).name : '';
          if (ev.outcome.kind === 'sunk' || ev.outcome.kind === 'win') {
            later(() => {
              fx.emit({ type: 'sink', coord: c, side: 'player' });
            }, 450);
            set({
              lastOutcome: { by: 'ai', text: `Legacy rolled back ${shipName}`, seq: match.log.length },
            });
          } else {
            set({ lastOutcome: { by: 'ai', text: `Regression in ${shipName}`, seq: match.log.length } });
          }
        }
        // Reveal Legacy's result now; input stays locked through the review.
        set((s) => ({ matchVersion: s.matchVersion + 1, aiThinking: false }));
        if (match.winner) {
          finishIfOver(match);
          return;
        }
        later(() => {
          if (get().phase !== 'battle' || get().match !== match) return;
          match.turn = 'player';
          set({ turnLock: false });
        }, AI_REVIEW_MS);
      }, MISSILE_FLIGHT_MS);
    }, delay);
  };

  return {
    phase: 'menu',
    difficulty: 'officer',
    commanderId: loadCommander(),
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
    story: null,
    paused: false,
    conceded: false,
    lastLayout: null,
    records: loadRecords(),
    settings: initialSettings,
    settingsOpen: false,

    goMenu: () => {
      cancelTimers();
      set({
        phase: 'menu',
        match: null,
        stats: null,
        story: null,
        aiThinking: false,
        turnLock: false,
        target: null,
        paused: false,
        lastOutcome: null,
      });
    },
    goHowTo: () => set({ phase: 'howto' }),
    goDifficulty: () => set({ phase: 'commander' }),
    goCommander: () => set({ phase: 'commander' }),
    selectCommander: (id) => {
      try {
        localStorage.setItem(COMMANDER_KEY, id);
      } catch {
        /* private mode */
      }
      set({ commanderId: id, phase: 'difficulty' });
    },
    concede: () => {
      const { match } = get();
      if (!match || match.winner) return;
      match.winner = 'ai';
      if (get().paused) get().resumeGame();
      set({ target: null, turnLock: true, aiThinking: false, conceded: true });
      finishIfOver(match);
    },

    startDeploy: (d) => {
      audio.click();
      cancelTimers();
      set({
        paused: false,
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
      cancelTimers();
      const lastLayout = layoutOf(deploy.board);
      const match = createMatch(deploy.board, randomLayout(Math.random));
      const memory = loadPlacementMemory();
      const ai = makeAI(difficulty, Math.random, { memory });
      persistPlacementMemory(recordPlacement(memory, deploy.board.ships.map((ship) => ship.cells)));
      set({
        lastLayout,
        paused: false,
        conceded: false,
        stats: null,
        story: null,
        target: null,
        match,
        ai,
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
      if (s.phase !== 'battle' || !s.match || s.turnLock || s.paused || s.match.winner) return;
      const marks = s.match.enemy.marks;
      if (marks[c.y][c.x] !== 'unknown') return;
      fx.emit({ type: 'sonar', coord: c, side: 'enemy' });
      set({ target: c });
    },

    confirmFire: () => {
      const s = get();
      if (s.phase !== 'battle' || !s.target || s.turnLock || s.paused || !s.match) return;
      const target = s.target;
      const match = s.match;
      set({
        turnLock: true,
        lastOutcome: { by: 'player', text: `Deploying to ${cellName(target)}…`, seq: -match.log.length - 1 },
      });
      fx.emit({ type: 'missile', coord: target, side: 'enemy' });
      later(() => {
        if (get().match !== match) return;
        resolvePlayerShot(target);
        // stays locked through the AI turn; scheduleAI unlocks after the
        // board review
      }, MISSILE_FLIGHT_MS);
    },

    setBoardView: (v) => {
      audio.click();
      set({ boardView: v });
    },

    playAgain: () => {
      audio.click();
      cancelTimers();
      set({ phase: 'difficulty', match: null, stats: null, story: null, paused: false, target: null, lastOutcome: null });
    },

    rematch: () => {
      const { lastLayout } = get();
      cancelTimers();
      audio.click();
      set({
        phase: 'deploy',
        match: null,
        stats: null,
        story: null,
        paused: false,
        target: null,
        lastOutcome: null,
        aiThinking: false,
        turnLock: false,
        boardView: 'enemy',
        deploy: {
          board: lastLayout && lastLayout.length === FLEET.length ? boardFromLayout(lastLayout) : createBoard(),
          selected: null,
          orientation: 'h',
        },
      });
    },

    pauseGame: () => {
      const { phase, match, paused } = get();
      if (phase !== 'battle' || !match || match.winner || paused) return;
      freezeTimers();
      pausedAt = Date.now();
      audio.setAmbientLevel(0.08);
      set({ paused: true });
    },

    resumeGame: () => {
      const { match, paused } = get();
      if (!paused) return;
      // Paused time doesn't count toward mission duration.
      if (match && pausedAt !== null) match.startedAt += Date.now() - pausedAt;
      pausedAt = null;
      thawTimers();
      audio.setAmbientLevel(0.2);
      set({ paused: false });
    },

    togglePause: () => (get().paused ? get().resumeGame() : get().pauseGame()),

    updateSettings: (patch) => {
      const s = { ...get().settings, ...patch };
      audio.setVolume(s.volume);
      audio.setMusicVolume(s.musicVolume);
      audio.setSfxVolume(s.sfxVolume);
      audio.setMuted(s.muted);
      persistSettings(s);
      set({ settings: s });
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
  };
});

export const placedCount = (s: GameStore) => s.deploy.board.ships.length;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __aether: typeof useGame }).__aether = useGame;
}
