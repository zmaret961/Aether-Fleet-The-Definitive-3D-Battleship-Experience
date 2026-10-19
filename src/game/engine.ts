import { allSunk, fireAt } from './board';
import type { Board } from './board';
import type { AIView, Difficulty } from './ai';
import { coordKey } from './types';
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
  const target = by === 'player' ? m.enemy : m.player;
  const outcome = fireAt(target, c);
  const ev: ShotEvent = { by, coord: c, outcome };
  if (outcome.kind !== 'already') {
    m.log.push(ev);
    if (outcome.kind === 'win') m.winner = by;
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
  const sunkCells = Array.from({ length: 10 }, () => Array<boolean>(10).fill(false));
  for (const ship of m.player.ships) {
    if (ship.sunk) for (const c of ship.cells) sunkCells[c.y][c.x] = true;
  }
  return {
    marks: m.player.marks,
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
  durationSec: number;
}

export const matchStats = (m: Match, difficulty: Difficulty): MatchStats => {
  const acc = accuracy(m, 'player');
  return {
    difficulty,
    winner: m.winner ?? 'player',
    shots: acc.shots,
    hits: acc.hits,
    accuracyPct: acc.pct,
    shipsSunk: m.enemy.ships.filter((s) => s.sunk).length,
    durationSec: Math.max(1, Math.round((Date.now() - m.startedAt) / 1000)),
  };
};

export const cellKeyOf = coordKey;
export { allSunk };
