import { useEffect, useState } from 'react';
import { DIFFICULTY_INFO } from '../game/ai';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';
import { CommanderAvatar } from './CommanderAvatar';
import { COMMANDERS, ENEMY_FLEET_NAMES, FLEET } from '../game/types';
import { useCountUp, useHotkeys } from './hotkeys';
import { MatchStoryPanel } from './MatchStory';

export function ResultScreen() {
  const stats = useGame((s) => s.stats);
  const match = useGame((s) => s.match);
  const records = useGame((s) => s.records);
  const playAgain = useGame((s) => s.playAgain);
  const goMenu = useGame((s) => s.goMenu);
  const rematch = useGame((s) => s.rematch);
  const story = useGame((s) => s.story);
  const difficulty = useGame((s) => s.difficulty);
  const commanderId = useGame((s) => s.commanderId);

  // brief grace so a key mashed to skip the finale doesn't also rematch / quit
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(t);
  }, []);
  useHotkeys({ Enter: rematch, Escape: goMenu }, armed);

  if (!stats) return null;
  const won = stats.winner === 'player';
  const mins = Math.floor(stats.durationSec / 60);
  const secs = stats.durationSec % 60;
  const commander = COMMANDERS.find((entry) => entry.id === commanderId) ?? COMMANDERS[0];
  const misses = stats.shots - stats.hits;
  const changeFailureRate = 100 - stats.accuracyPct;
  const rec = records[difficulty];

  const log = match?.log ?? [];
  let streak = 0;
  let bestStreak = 0;
  for (const ev of log) {
    if (ev.by !== 'player') continue;
    streak = ev.outcome.kind === 'miss' ? 0 : streak + 1;
    bestStreak = Math.max(bestStreak, streak);
  }
  const aiShots = log.filter((e) => e.by === 'ai');
  const aiAcc = aiShots.length ? Math.round((aiShots.filter((e) => e.outcome.kind !== 'miss').length / aiShots.length) * 100) : 0;
  const fleetAfloat = match ? match.player.ships.filter((s) => !s.sunk).length : 0;

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4 pointer-events-none">
      <div className="vignette absolute inset-0" aria-hidden="true" />
      <FadeIn className={`relative pointer-events-auto w-full ${story ? 'max-w-4xl' : 'max-w-3xl'}`}>
        <GlassPanel strong className="max-h-[calc(100vh-2rem)] overflow-y-auto p-6 sm:p-8">
          <div
            className={`pointer-events-none absolute -top-32 left-1/2 h-64 w-[40rem] -translate-x-1/2 rounded-full blur-3xl ${
              won ? 'bg-accent-2/30' : 'bg-danger/20'
            }`}
            aria-hidden="true"
          />
          <header className="relative text-center">
            <div className="label-caps mb-3">
              Field report · vs <span className={won ? 'text-accent' : 'text-danger'}>{DIFFICULTY_INFO[difficulty].label}</span>
            </div>
            <h2 className={`title-display text-6xl sm:text-7xl ${won ? '' : 'title-danger'}`}>
              {story?.headline ?? (won ? 'Shipped.' : 'Rolled back.')}
            </h2>
            <p className="mt-3 text-sm text-white/70 sm:text-base">
              {story?.subhead ?? (won ? 'Production is green. The backlog is closed.' : 'Rollback complete. Open a fresh branch and regroup.')}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2.5 text-sm text-white/75">
              <CommanderAvatar id={commander.id} size="sm" />
              <span>
                Commanded by <strong className="text-white">{commander.name}</strong>
              </span>
              <span className="text-white/30">·</span>
              <span className="num">
                {mins}:{String(secs).padStart(2, '0')}
              </span>
            </div>
          </header>

          <div className="relative mt-7 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
            <AccuracyRing pct={stats.accuracyPct} won={won} />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Tile label="Shots fired" value={stats.shots} />
              <Tile label="Hits" value={stats.hits} tone="text-ember" />
              <Tile label="Misses" value={misses} tone="text-white/80" />
              <Tile label="Tickets closed" value={stats.shipsSunk} suffix="/5" tone="text-success" />
              <Tile label="Fleet afloat" value={fleetAfloat} suffix="/5" tone={fleetAfloat ? 'text-accent' : 'text-danger'} />
              <Tile label="Best streak" value={bestStreak} />
            </div>
          </div>

          <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="label-caps mb-3">Enemy backlog</div>
              <ul className="space-y-1.5 text-sm">
                {FLEET.map((f) => {
                  const sunk = match?.enemy.ships.find((s) => s.spec.id === f.id)?.sunk;
                  return (
                    <li key={f.id} className="flex items-center justify-between">
                      <span className={sunk ? 'text-white/55 line-through decoration-success/70' : 'text-white/85'}>{ENEMY_FLEET_NAMES[f.id]}</span>
                      <span className={`text-[0.625rem] font-semibold uppercase tracking-[0.14em] ${sunk ? 'text-success' : 'text-white/50'}`}>
                        {sunk ? 'Closed' : 'Open'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="label-caps text-accent">DORA-style metrics</span>
                <span className="text-[0.625rem] text-white/45">Not real DORA</span>
              </div>
              <dl className="space-y-2 text-sm">
                <Metric label="Deployment frequency" value={`${(stats.hits / Math.max(stats.shots, 1)).toFixed(2)} hits/turn`} />
                <Metric label="Change failure rate" value={`${changeFailureRate}%`} />
                <Metric label="Lead time to first sink" value={stats.firstSinkTurn === null ? 'No sink' : `${stats.firstSinkTurn} turns`} />
                <Metric label="ACUs spent" value={(stats.shots * 0.25).toFixed(2)} />
                <Metric label="Legacy accuracy" value={`${aiAcc}%`} />
              </dl>
            </div>
          </div>

          {story && (
            <div className="relative mt-4">
              <MatchStoryPanel story={story} />
            </div>
          )}

          <footer className="sticky -bottom-6 z-10 -mx-6 mt-4 flex flex-col-reverse items-center justify-between gap-3 border-t border-white/10 bg-[#0a1020]/90 px-6 pt-4 pb-6 backdrop-blur-md sm:-bottom-8 sm:-mx-8 sm:flex-row sm:px-8 sm:pb-8">
            <span className="num text-xs text-white/60">
              Record vs {DIFFICULTY_INFO[difficulty].label}: <strong className="text-white">{rec ? `${rec.wins}W – ${rec.losses}L` : '—'}</strong>
            </span>
            <div className="flex flex-wrap justify-center gap-2.5">
              <GlassButton variant="primary" hotkey="Enter" onClick={rematch}>
                Rematch · same fleet
              </GlassButton>
              <GlassButton onClick={playAgain}>Change difficulty</GlassButton>
              <GlassButton hotkey="Esc" onClick={goMenu}>
                Main Menu
              </GlassButton>
            </div>
          </footer>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}

function Tile({ label, value, suffix = '', tone = 'text-white' }: { label: string; value: number; suffix?: string; tone?: string }) {
  const v = useCountUp(value, 900, 250);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
      <div className={`num text-2xl font-bold leading-none ${tone}`}>
        {Math.round(v)}
        <span className="text-base text-white/40">{suffix}</span>
      </div>
      <div className="label-caps mt-1.5 !text-[0.625rem] !tracking-[0.12em]">{label}</div>
    </div>
  );
}

function AccuracyRing({ pct, won }: { pct: number; won: boolean }) {
  const v = useCountUp(pct, 1100, 200);
  const r = 52;
  const len = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-36 w-36" role="img" aria-label={`Accuracy ${pct}%`}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="acc-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={won ? '#c3ccff' : '#ffd1d9'} />
            <stop offset="1" stopColor={won ? '#5146ff' : '#fb7185'} />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="url(#acc-grad)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - v / 100)}
          style={{ filter: `drop-shadow(0 0 8px ${won ? 'rgba(81,70,255,0.6)' : 'rgba(251,113,133,0.5)'})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-3xl font-extrabold text-white">{Math.round(v)}%</span>
        <span className="label-caps !text-[0.625rem]">Accuracy</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-white/60">{label}</dt>
      <dd className="num font-semibold text-white">{value}</dd>
    </div>
  );
}
