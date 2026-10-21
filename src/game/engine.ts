import { allSunk, fireAt } from './board';
import type { Board } from './board';
import type { AIView, Difficulty } from './ai';
import { GRID_SIZE, coordKey } from './types';
import type { Coord, ShotOutcome } from './types';

export type Side = 'player' | 'ai';

export interface ShotEvent {
  by: Side;
  coord: Coord;
  outcome: ShotOutcome;
}

export interface Match {
  /** the player's fleet + the AI's shots marked on it */
  player: Board;
  /** the AI fleet + the player's shots marked on it */
  enemy: Board;
  turn: Side;
  winner: Side | null;
  log: ShotEvent[];
  startedAt: number;
}

export const createMatch = (player: Board, enemy: Board): Match => ({
  player,
  enemy,
  turn: 'player',
  winner: null,
  log: [],
  startedAt: Date.now(),
});

export const shoot = (m: Match, by: Side, c: Coord): ShotEvent => {
  if (m.winner !== null || by !== m.turn) return { by, coord: c, outcome: { kind: 'already' } };
  const target = by === 'player' ? m.enemy : m.player;
  const outcome = fireAt(target, c);
  const ev: ShotEvent = { by, coord: c, outcome };
  if (outcome.kind !== 'already') {
    m.log.push(ev);
    if (outcome.kind === 'win') {
      m.winner = by;
    } else {
      m.turn = by === 'player' ? 'ai' : 'player';
    }
  }
  return ev;
};

export const accuracy = (m: Match, by: Side): { shots: number; hits: number; pct: number } => {
  const shots = m.log.filter((e) => e.by === by).length;
  const hits = m.log.filter(
    (e) => e.by === by && (e.outcome.kind === 'hit' || e.outcome.kind === 'sunk' || e.outcome.kind === 'win'),
  ).length;
  return { shots, hits, pct: shots === 0 ? 0 : Math.round((hits / shots) * 100) };
};

/** Build the legal information set an AI may use. */
export const aiView = (m: Match): AIView => {
  const sunkCells = Array.from({ length: GRID_SIZE }, () => Array<boolean>(GRID_SIZE).fill(false));
  for (const ship of m.player.ships) {
    if (ship.sunk) for (const c of ship.cells) sunkCells[c.y][c.x] = true;
  }
  return {
    marks: m.player.marks.map((row) => [...row]),
    sunkCells,
    remainingLengths: m.player.ships.filter((s) => !s.sunk).map((s) => s.spec.length),
  };
};

export const isOver = (m: Match): boolean => m.winner !== null;

export interface MatchStats {
  difficulty: Difficulty;
  winner: Side;
  shots: number;
  hits: number;
  accuracyPct: number;
  shipsSunk: number;
  firstSinkTurn: number | null;
  durationSec: number;
  aiShots: number;
  aiHits: number;
  aiAccuracyPct: number;
  playerShipsLost: number;
  longestHitStreak: number;
}

export const matchStats = (m: Match, difficulty: Difficulty): MatchStats => {
  const acc = accuracy(m, 'player');
  let playerTurn = 0;
  let firstSinkTurn: number | null = null;
  let currentHitStreak = 0;
  let longestHitStreak = 0;
  for (const event of m.log) {
    if (event.by !== 'player') continue;
    playerTurn += 1;
    if (firstSinkTurn === null && (event.outcome.kind === 'sunk' || event.outcome.kind === 'win')) {
      firstSinkTurn = playerTurn;
    }
    if (event.outcome.kind === 'hit' || event.outcome.kind === 'sunk' || event.outcome.kind === 'win') {
      currentHitStreak += 1;
      longestHitStreak = Math.max(longestHitStreak, currentHitStreak);
    } else {
      currentHitStreak = 0;
    }
  }
  const aiAcc = accuracy(m, 'ai');
  return {
    difficulty,
    winner: m.winner ?? 'player',
    shots: acc.shots,
    hits: acc.hits,
    accuracyPct: acc.pct,
    shipsSunk: m.enemy.ships.filter((s) => s.sunk).length,
    firstSinkTurn,
    durationSec: Math.max(1, Math.round((Date.now() - m.startedAt) / 1000)),
    aiShots: aiAcc.shots,
    aiHits: aiAcc.hits,
    aiAccuracyPct: aiAcc.pct,
    playerShipsLost: m.player.ships.filter((s) => s.sunk).length,
    longestHitStreak,
  };
};

export const cellKeyOf = coordKey;
export { allSunk };
