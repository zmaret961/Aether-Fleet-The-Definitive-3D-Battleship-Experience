import { accuracy } from './engine';
import type { Match } from './engine';
import { ENEMY_FLEET_NAMES, shipSpec } from './types';
import type { Coord } from './types';

export type BeatTone = 'win' | 'loss' | 'neutral';

export interface StoryBeat {
  /** player turn the beat happened on (1-based) */
  turn: number;
  tone: BeatTone;
  title: string;
  detail: string;
}

export interface MatchStory {
  headline: string;
  subhead: string;
  beats: StoryBeat[];
  /** player's fleet still afloat at the end */
  playerAfloat: number;
  /** enemy fleet still afloat at the end */
  enemyAfloat: number;
  ai: { shots: number; hits: number; pct: number };
  bestHitStreak: number;
  longestDrought: number;
  monolithQuote: string;
}

const cell = (c: Coord) => `${String.fromCharCode(65 + c.x)}${c.y + 1}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const MONOLITH_WIN_QUOTES = [
  'IF FLEET-STATUS = "DESTROYED" PERFORM ABEND-ROUTINE. STOP RUN.',
  'MY COPYBOOKS... THEY WERE LOAD-BEARING...',
  'YOU HAVE NOT SEEN THE LAST OF MY NIGHTLY BATCH JOB.',
];
const MONOLITH_LOSS_QUOTES = [
  'WORKS ON MY MAINFRAME. SEE YOU IN 1987.',
  'PERFORM VICTORY-LAP VARYING SMUGNESS FROM 1 BY 1.',
  'YOUR MIGRATION HAS BEEN DEFERRED TO NEXT FISCAL YEAR.',
];

/**
 * Turn the shot log into a short, Cognition-flavoured narrative for the
 * field report. Pure: no React, no randomness beyond the seed you pass.
 */
export const buildStory = (m: Match, opts: { conceded?: boolean; seed?: number } = {}): MatchStory => {
  const won = m.winner === 'player';
  const beats: StoryBeat[] = [];
  let playerTurn = 0;
  let firstBlood = false;
  let firstLoss = false;
  const firstContact = new Map<string, number>();
  let streak = 0;
  let bestHitStreak = 0;
  let bestStreakTurn = 0;
  let drought = 0;
  let longestDrought = 0;
  let droughtEndTurn = 0;
  let droughtBroken = false;

  for (const ev of m.log) {
    if (ev.by === 'player') {
      playerTurn += 1;
      const isHit = ev.outcome.kind !== 'miss' && ev.outcome.kind !== 'already';
      if (isHit) {
        streak += 1;
        if (streak > bestHitStreak) {
          bestHitStreak = streak;
          bestStreakTurn = playerTurn;
        }
        if (drought > longestDrought) {
          longestDrought = drought;
          droughtEndTurn = playerTurn;
          droughtBroken = true;
        }
        drought = 0;
      } else {
        streak = 0;
        drought += 1;
      }
      if (isHit && 'shipId' in ev.outcome && !firstContact.has(ev.outcome.shipId)) {
        firstContact.set(ev.outcome.shipId, playerTurn);
      }
      if (isHit && !firstBlood) {
        firstBlood = true;
        beats.push({
          turn: playerTurn,
          tone: 'win',
          title: 'First green build',
          detail: `Direct hit on ${cell(ev.coord)}. The Monolith's fans spin up.`,
        });
      }
      if ((ev.outcome.kind === 'sunk' || ev.outcome.kind === 'win') && 'shipId' in ev.outcome) {
        const name = ENEMY_FLEET_NAMES[ev.outcome.shipId];
        const chase = playerTurn - (firstContact.get(ev.outcome.shipId) ?? playerTurn);
        const chaseText = chase === 0 ? 'one-shot' : `${plural(chase, 'turn')} from first contact`;
        beats.push({
          turn: playerTurn,
          tone: 'win',
          title: ev.outcome.kind === 'win' ? `Final ticket closed: ${name}` : `Ticket closed: ${name}`,
          detail:
            ev.outcome.kind === 'win'
              ? `Last shot lands on ${cell(ev.coord)}. Backlog at zero.`
              : `Sunk at ${cell(ev.coord)}, ${chaseText}.`,
        });
      }
    } else {
      const turn = Math.max(playerTurn, 1);
      const isHit = ev.outcome.kind !== 'miss' && ev.outcome.kind !== 'already';
      if (isHit && !firstLoss) {
        firstLoss = true;
        const shipName = 'shipId' in ev.outcome ? shipSpec(ev.outcome.shipId).name : 'the fleet';
        beats.push({
          turn,
          tone: 'loss',
          title: 'First regression',
          detail: `Legacy finds ${shipName} at ${cell(ev.coord)}.`,
        });
      }
      if ((ev.outcome.kind === 'sunk' || ev.outcome.kind === 'win') && 'shipId' in ev.outcome) {
        const shipName = shipSpec(ev.outcome.shipId).name;
        beats.push({
          turn,
          tone: 'loss',
          title: `${shipName} rolled back`,
          detail: `The Monolith takes ${shipName} offline at ${cell(ev.coord)}.`,
        });
      }
    }
  }
  if (drought > longestDrought) longestDrought = drought;

  if (droughtBroken && longestDrought >= 6) {
    beats.push({
      turn: droughtEndTurn,
      tone: 'neutral',
      title: 'Persistence pays',
      detail: `${plural(longestDrought, 'failed build')} in a row, then green. Devin doesn't get discouraged.`,
    });
  }
  if (bestHitStreak >= 4) {
    beats.push({
      turn: bestStreakTurn,
      tone: 'win',
      title: 'Merge streak',
      detail: `${plural(bestHitStreak, 'consecutive hit')}: a whole sprint without a red check.`,
    });
  }
  if (opts.conceded) {
    beats.push({
      turn: Math.max(playerTurn, 1),
      tone: 'loss',
      title: 'Rollback requested',
      detail: 'You called the rollback. The postmortem is blameless.',
    });
  }

  const isFinale = (b: StoryBeat) => b.title.startsWith('Final ticket') || b.title === 'Rollback requested';
  beats.sort((a, b) => Number(isFinale(a)) - Number(isFinale(b)) || a.turn - b.turn);
  // Keep the moments that matter most, then retell them in order.
  const MAX_BEATS = 7;
  const priority = (b: StoryBeat) =>
    isFinale(b) ? 0
    : b.title === 'First green build' ? 1
    : b.title === 'Persistence pays' || b.title === 'Merge streak' ? 2
    : b.tone === 'win' ? 3
    : b.title === 'First regression' ? 4
    : 5;
  const keep = new Set([...beats].sort((x, y) => priority(x) - priority(y)).slice(0, MAX_BEATS));
  const trimmed = beats.filter((b) => keep.has(b));

  const playerAfloat = m.player.ships.filter((s) => !s.sunk).length;
  const enemyAfloat = m.enemy.ships.filter((s) => !s.sunk).length;

  let headline: string;
  let subhead: string;
  if (won) {
    if (playerAfloat === m.player.ships.length) {
      headline = 'Flawless deploy.';
      subhead = 'Zero regressions. The whole fleet ships to production untouched.';
    } else if (playerAfloat === 1) {
      const survivor = m.player.ships.find((s) => !s.sunk)?.spec.name ?? 'one ship';
      headline = 'Shipped at the buzzer.';
      subhead = `${survivor} closed the last ticket alone. Merge it before anyone asks questions.`;
    } else {
      headline = 'Shipped.';
      subhead = `Production is green with ${plural(playerAfloat, 'ship')} still on station.`;
    }
  } else if (opts.conceded) {
    headline = 'Rolled back.';
    subhead = 'Branch abandoned mid-review. Open a fresh one and regroup.';
  } else if (enemyAfloat === 1) {
    headline = 'One ticket from green.';
    const holdout = m.enemy.ships.find((s) => !s.sunk);
    subhead = `Only ${holdout ? ENEMY_FLEET_NAMES[holdout.spec.id] : 'one ticket'} survived. The Monolith is sweating COBOL.`;
  } else {
    headline = 'Rolled back.';
    subhead = 'The Legacy Monolith keeps its uptime. For now.';
  }

  const quotes = won ? MONOLITH_WIN_QUOTES : MONOLITH_LOSS_QUOTES;
  const seed = opts.seed ?? m.log.length;
  return {
    headline,
    subhead,
    beats: trimmed,
    playerAfloat,
    enemyAfloat,
    ai: accuracy(m, 'ai'),
    bestHitStreak,
    longestDrought,
    monolithQuote: quotes[Math.abs(seed) % quotes.length],
  };
};
