import { describe, it } from 'vitest';
import { AdmiralAI, makeAI } from './ai';
import type { AIPlayer, AdmiralOptions, Difficulty } from './ai';
import { randomLayout } from './board';
import type { Board } from './board';
import { aiView, createMatch, shoot } from './engine';
import { humanLikeLayout, randomHumanStyle } from './humanLayouts';
import { DEFAULT_PRIOR_TUNING, UNIFORM_PRIOR, priorFromMemory, recordPlacement } from './prior';
import type { PlacementMemory, PriorTuning } from './prior';
import { createRng } from './rng';

/**
 * Opt-in benchmark (skipped in CI):
 *   AI_BENCH=1 npx vitest run src/game/ai.bench.test.ts
 * AI_BENCH_N sets games per row (default 300), AI_BENCH_PLAYERS the number of
 * simulated repeat players (default 60) and AI_BENCH_GAMES their games each (default 8).
 */
const environment = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;
const AI_BENCH = Boolean(environment?.AI_BENCH);
const N = Number(environment?.AI_BENCH_N ?? 300);
const PLAYERS = Number(environment?.AI_BENCH_PLAYERS ?? 60);
const GAMES_PER_PLAYER = Number(environment?.AI_BENCH_GAMES ?? 8);
const ONLY = environment?.AI_BENCH_ONLY;
/** shift every seed, e.g. to tune on different games than the ones reported */
const SEED = Number(environment?.AI_BENCH_SEED ?? 0);
const TUNING: PriorTuning = { ...DEFAULT_PRIOR_TUNING, ...JSON.parse(environment?.AI_BENCH_TUNE ?? '{}') };

interface Stats {
  shots: number[];
  ms: number;
  moves: number;
  maxMs: number;
}

const newStats = (): Stats => ({ shots: [], ms: 0, moves: 0, maxMs: 0 });

const play = (board: Board, ai: AIPlayer, stats: Stats) => {
  const match = createMatch(board, randomLayout(createRng(1)));
  let shots = 0;
  while (!match.winner && shots < 100) {
    match.turn = 'ai';
    const start = performance.now();
    const coord = ai.next(aiView(match));
    const elapsed = performance.now() - start;
    stats.ms += elapsed;
    stats.maxMs = Math.max(stats.maxMs, elapsed);
    stats.moves++;
    shoot(match, 'ai', coord);
    shots++;
  }
  stats.shots.push(shots);
};

const format = (name: string, s: Stats): string => {
  const sorted = [...s.shots].sort((a, b) => a - b);
  const avg = s.shots.reduce((sum, n) => sum + n, 0) / s.shots.length;
  const sd = Math.sqrt(s.shots.reduce((sum, n) => sum + (n - avg) ** 2, 0) / s.shots.length);
  return `${name.padEnd(34)} avg=${avg.toFixed(2)} ±${(sd / Math.sqrt(s.shots.length)).toFixed(2)} median=${sorted[Math.floor(sorted.length / 2)]} p10=${sorted[Math.floor(sorted.length * 0.1)]} p90=${sorted[Math.floor(sorted.length * 0.9)]} ms/move=${(s.ms / s.moves).toFixed(2)} max=${s.maxMs.toFixed(1)}`;
};

type Factory = (seed: number, memory: PlacementMemory | null) => AIPlayer;

const tier = (difficulty: Difficulty): Factory => (seed, memory) =>
  difficulty === 'admiral'
    ? new AdmiralAI(createRng(seed), { prior: priorFromMemory(memory, TUNING) })
    : makeAI(difficulty, createRng(seed));

const admiral = (options: AdmiralOptions): Factory => (seed) => new AdmiralAI(createRng(seed), options);

const shipsOf = (board: Board) => board.ships.map((ship) => ship.cells);

/** Fresh random layouts, no history. */
const vsRandom = (factory: Factory): Stats => {
  const stats = newStats();
  for (let game = 0; game < N; game++) {
    play(randomLayout(createRng(SEED + 1000 + game)), factory(SEED + 50_000 + game, null), stats);
  }
  return stats;
};

/** One hand-placed layout per simulated stranger, no history. */
const vsHuman = (factory: Factory): Stats => {
  const stats = newStats();
  for (let game = 0; game < N; game++) {
    const rng = createRng(SEED + 7000 + game);
    play(humanLikeLayout(rng, randomHumanStyle(rng)), factory(SEED + 60_000 + game, null), stats);
  }
  return stats;
};

/** Repeat players: the same persona deploys game after game; history accumulates. */
const vsRepeatPlayer = (factory: Factory, useMemory: boolean): { early: Stats; late: Stats } => {
  const early = newStats();
  const late = newStats();
  for (let player = 0; player < PLAYERS; player++) {
    const rng = createRng(SEED + 90_000 + player);
    const style = randomHumanStyle(rng);
    let memory: PlacementMemory | null = null;
    for (let game = 0; game < GAMES_PER_PLAYER; game++) {
      const board = humanLikeLayout(rng, style);
      play(board, factory(SEED + 70_000 + player * 100 + game, useMemory ? memory : null), game < 3 ? early : late);
      memory = recordPlacement(memory, shipsOf(board));
    }
  }
  return { early, late };
};

describe.skipIf(!AI_BENCH)('opt-in AI benchmark', () => {
  it(
    'reports every tier against random, human-like and repeat-player layouts',
    () => {
      const rows: [string, Factory][] = [
        ['cadet', tier('cadet')],
        ['officer', tier('officer')],
        ['commander', tier('commander')],
        ['admiral', tier('admiral')],
        ['admiral (uniform prior)', admiral({ prior: UNIFORM_PRIOR })],
        ['admiral (raw-count hunt)', admiral({ huntMarginals: 'counts' })],
      ];
      const selected = ONLY ? rows.filter(([name]) => ONLY.split(',').includes(name)) : rows;
      console.log(`--- vs uniformly random layouts (${N} games) ---`);
      for (const [name, factory] of selected) console.log(format(name, vsRandom(factory)));
      console.log(`--- vs human-like layouts, first meeting (${N} games) ---`);
      for (const [name, factory] of selected) console.log(format(name, vsHuman(factory)));
      console.log(`--- repeat players (${PLAYERS} personas x ${GAMES_PER_PLAYER} games; late = games 4+) ---`);
      for (const [name, factory, memory] of [
        ['commander', tier('commander'), false],
        ['admiral (no memory)', tier('admiral'), false],
        ['admiral (learns this player)', tier('admiral'), true],
      ] as [string, Factory, boolean][]) {
        if (ONLY && !ONLY.split(',').some((only) => name.startsWith(only))) continue;
        const { early, late } = vsRepeatPlayer(factory, memory);
        console.log(format(`${name} early`, early));
        console.log(format(`${name} late`, late));
      }
    },
    3_600_000,
  );
});
