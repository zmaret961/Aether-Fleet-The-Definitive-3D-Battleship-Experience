import { describe, it } from 'vitest';
import { AdmiralAI, DEFAULT_ADMIRAL_SAMPLES, makeAI } from './ai';
import type { AdmiralOptions, Difficulty } from './ai';
import { randomLayout } from './board';
import { aiView, createMatch, shoot } from './engine';
import { createRng } from './rng';

const environment = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;
const AI_BENCH = Boolean(environment?.AI_BENCH);
const N = Number(environment?.AI_BENCH_N ?? 300);

interface BenchmarkResult {
  shots: number[];
  average: number;
  median: number;
  p10: number;
  p90: number;
  msPerMove: number;
  maxMs: number;
}

const summarize = (shots: number[], totalMs: number, moves: number, maxMs: number): BenchmarkResult => {
  const ordered = [...shots].sort((a, b) => a - b);
  return {
    shots,
    average: shots.reduce((sum, count) => sum + count, 0) / shots.length,
    median: ordered[Math.floor(ordered.length / 2)],
    p10: ordered[Math.floor(ordered.length * 0.1)],
    p90: ordered[Math.floor(ordered.length * 0.9)],
    msPerMove: totalMs / moves,
    maxMs,
  };
};

const runBenchmark = (
  difficulty: Difficulty,
  count: number,
  options?: AdmiralOptions,
): BenchmarkResult => {
  const shots: number[] = [];
  let totalMs = 0;
  let moves = 0;
  let maxMs = 0;
  for (let game = 0; game < count; game++) {
    const layoutRng = createRng(1000 + game);
    const aiRng = createRng(50_000 + game);
    const match = createMatch(randomLayout(layoutRng), randomLayout(layoutRng));
    const ai =
      difficulty === 'admiral' && options
        ? new AdmiralAI(aiRng, options)
        : makeAI(difficulty, aiRng);
    let gameShots = 0;
    while (!match.winner && gameShots < 100) {
      match.turn = 'ai';
      const start = performance.now();
      const coord = ai.next(aiView(match));
      const elapsed = performance.now() - start;
      totalMs += elapsed;
      maxMs = Math.max(maxMs, elapsed);
      moves++;
      shoot(match, 'ai', coord);
      gameShots++;
    }
    shots.push(gameShots);
  }
  return summarize(shots, totalMs, moves, maxMs);
};

const format = (name: string, result: BenchmarkResult): string =>
  `${name.padEnd(22)} avg=${result.average.toFixed(2)} median=${result.median} p10=${result.p10} p90=${result.p90} msPerMove=${result.msPerMove.toFixed(2)} maxMs=${result.maxMs.toFixed(2)}`;

describe.skipIf(!AI_BENCH)('opt-in AI benchmark', () => {
  it(
    'reports tier results and Admiral sampling comparisons',
    () => {
      const tierResults = new Map<Difficulty, BenchmarkResult>();
      for (const difficulty of ['cadet', 'officer', 'commander', 'admiral'] as Difficulty[]) {
        const result = runBenchmark(difficulty, N);
        tierResults.set(difficulty, result);
        console.log(format(difficulty, result));
      }

      const weighted = runBenchmark('admiral', N, {
        samples: DEFAULT_ADMIRAL_SAMPLES,
        importanceWeighting: true,
        huntMode: 'analytic',
      });
      const unweighted = tierResults.get('admiral')!;
      const analyticHunt = unweighted;
      const monteCarloHunt = runBenchmark('admiral', N, {
        samples: DEFAULT_ADMIRAL_SAMPLES,
        huntSamples: 1500,
        importanceWeighting: false,
        huntMode: 'monte-carlo',
      });
      console.log(`Admiral target weighted vs unweighted (${N} games)`);
      console.log(format('importance-weighted', weighted));
      console.log(format('unweighted', unweighted));
      console.log(`Admiral hunt analytic vs Monte Carlo (${N} games)`);
      console.log(format('analytic hunt', analyticHunt));
      console.log(format('Monte Carlo hunt', monteCarloHunt));
    },
    600_000,
  );
});
