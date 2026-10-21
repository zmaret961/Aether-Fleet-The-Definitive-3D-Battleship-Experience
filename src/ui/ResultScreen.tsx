import { useId, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DIFFICULTY_INFO } from '../game/ai';
import type { StoryBeat } from '../game/story';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';
import { CommanderAvatar } from './CommanderAvatar';
import { COMMANDERS, ENEMY_FLEET_NAMES, FLEET } from '../game/types';
import { useCountUp, useHotkeys } from './hotkeys';

type Tab = 'timeline' | 'backlog' | 'metrics';
const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'metrics', label: 'DORA-ish' },
];

const BEAT_DOT: Record<StoryBeat['tone'], string> = {
  win: 'bg-accent shadow-[0_0_10px_var(--color-accent)]',
  loss: 'bg-danger shadow-[0_0_10px_rgba(251,113,133,0.7)]',
  neutral: 'bg-ember shadow-[0_0_10px_rgba(251,191,36,0.6)]',
};

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
  const [tab, setTab] = useState<Tab>('timeline');
  const [copied, setCopied] = useState(false);
  const tabsId = useId();

  useHotkeys({ Enter: rematch, Escape: goMenu, d: playAgain });

  if (!stats) return null;
  const won = stats.winner === 'player';
  const mins = Math.floor(stats.durationSec / 60);
  const secs = stats.durationSec % 60;
  const commander = COMMANDERS.find((entry) => entry.id === commanderId) ?? COMMANDERS[0];
  const misses = stats.shots - stats.hits;
  const changeFailureRate = 100 - stats.accuracyPct;
  const rec = records[difficulty];
  const info = DIFFICULTY_INFO[difficulty];

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
  const beats = story?.beats ?? [];
  const lastTurn = Math.max(stats.shots, ...beats.map((b) => b.turn), 1);
  const vsPar = stats.shots - info.avgShots;

  const report = [
    `AETHER FLEET · Field report`,
    `${won ? 'SHIPPED' : 'ROLLED BACK'} vs ${info.label} (${info.tagline})`,
    `Commander: ${commander.name} · ${mins}:${String(secs).padStart(2, '0')}`,
    `${stats.shots} shots · ${stats.hits} hits · ${stats.accuracyPct}% accuracy · ${stats.shipsSunk}/5 tickets closed · ${fleetAfloat}/5 fleet afloat`,
    `Legacy Monolith accuracy: ${aiAcc}%`,
    ...beats.map((b) => `T${b.turn} ${b.title}: ${b.detail}`),
    story ? `LEGACY-MONOLITH> ${story.monolithQuote}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    document.getElementById(`${tabsId}-${next}`)?.focus();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-4 pointer-events-none">
      <div className="vignette absolute inset-0" aria-hidden="true" />
      <FadeIn className="relative pointer-events-auto flex max-h-full w-full max-w-5xl">
        <GlassPanel strong className="flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden !p-0 sm:max-h-[calc(100dvh-2rem)]">
          <div
            className={`pointer-events-none absolute -top-32 left-1/2 h-64 w-[44rem] max-w-full -translate-x-1/2 rounded-full blur-3xl ${
              won ? 'bg-accent-2/30' : 'bg-danger/20'
            }`}
            aria-hidden="true"
          />
          {/* scrolls only on very short screens; the action bar below stays pinned */}
          <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-5 sm:px-8 sm:pt-6">
            <header className="text-center">
              <div className="label-caps mb-2">
                Field report · vs <span className={won ? 'text-accent' : 'text-danger'}>{info.label}</span>
              </div>
              <h2 className={`title-display text-5xl sm:text-6xl ${won ? '' : 'title-danger'}`}>
                {story?.headline ?? (won ? 'Shipped.' : 'Rolled back.')}
              </h2>
              <p className="mt-2 text-sm text-white/70 sm:text-[0.95rem]">
                {story?.subhead ?? (won ? 'Production is green. The backlog is closed.' : 'Rollback complete. Open a fresh branch and regroup.')}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-white/75">
                <CommanderAvatar id={commander.id} size="sm" />
                <span>
                  Commanded by <strong className="text-white">{commander.name}</strong>
                </span>
                <span className="text-white/30">·</span>
                <span className="num">
                  {mins}:{String(secs).padStart(2, '0')}
                </span>
                <span className="text-white/30">·</span>
                <span className="num">
                  {won ? (
                    <>
                      {Math.abs(vsPar)} shots {vsPar <= 0 ? 'under' : 'over'} {info.label.replace(/^The /, '')}&apos;s par of {info.avgShots}
                    </>
                  ) : (
                    <>Par for {info.label.replace(/^The /, '')}: {info.avgShots} shots</>
                  )}
                </span>
              </div>
            </header>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              {/* headline numbers */}
              <div className="grid grid-cols-[auto_1fr] items-center gap-3 sm:gap-4">
                <AccuracyRing pct={stats.accuracyPct} won={won} />
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  <Tile label="Shots" value={stats.shots} />
                  <Tile label="Hits" value={stats.hits} tone="text-ember" />
                  <Tile label="Misses" value={misses} tone="text-white/80" />
                  <Tile label="Closed" value={stats.shipsSunk} suffix="/5" tone="text-success" />
                  <Tile label="Afloat" value={fleetAfloat} suffix="/5" tone={fleetAfloat ? 'text-accent' : 'text-danger'} />
                  <Tile label="Streak" value={bestStreak} />
                </div>
              </div>

              {/* details: tabs instead of a tall stack */}
              <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03]">
                <div role="tablist" aria-label="Report details" className="flex gap-1 border-b border-white/8 p-1.5" onKeyDown={onTabKey}>
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      id={`${tabsId}-${t.id}`}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      aria-controls={`${tabsId}-panel`}
                      tabIndex={tab === t.id ? 0 : -1}
                      onClick={() => setTab(t.id)}
                      className={`flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
                        tab === t.id ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]' : 'text-white/50 hover:text-white/80'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div
                  id={`${tabsId}-panel`}
                  role="tabpanel"
                  aria-labelledby={`${tabsId}-${tab}`}
                  className="scroll-thin h-[11.5rem] overflow-y-auto px-4 py-3 text-sm"
                >
                  {tab === 'timeline' &&
                    (beats.length ? (
                      <ol className="relative ml-1 space-y-2 border-l border-white/10">
                        {beats.map((beat, i) => (
                          <li key={`${beat.title}-${i}`} className="relative pl-4">
                            <span className={`absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ${BEAT_DOT[beat.tone]}`} aria-hidden="true" />
                            <div className="flex items-baseline gap-2">
                              <span className="num font-mono text-[0.6rem] text-white/45">T{beat.turn}</span>
                              <span className="text-[0.8rem] font-semibold text-white">{beat.title}</span>
                            </div>
                            <div className="text-xs leading-snug text-white/55">{beat.detail}</div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-white/50">No notable beats this session.</p>
                    ))}
                  {tab === 'backlog' && (
                    <ul className="space-y-2">
                      {FLEET.map((f) => {
                        const sunk = match?.enemy.ships.find((s) => s.spec.id === f.id)?.sunk;
                        return (
                          <li key={f.id} className="flex items-center gap-3">
                            <span className="flex w-16 shrink-0 gap-0.5" aria-hidden="true">
                              {Array.from({ length: f.length }).map((_, i) => (
                                <span key={i} className={`pip !h-1 ${sunk ? 'pip-ok' : 'bg-white/15'}`} />
                              ))}
                            </span>
                            <span className={`flex-1 ${sunk ? 'text-white/55 line-through decoration-success/70' : 'text-white/85'}`}>{ENEMY_FLEET_NAMES[f.id]}</span>
                            <span className={`text-[0.625rem] font-semibold uppercase tracking-[0.14em] ${sunk ? 'text-success' : 'text-white/50'}`}>
                              {sunk ? 'Closed' : 'Open'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {tab === 'metrics' && (
                    <dl className="space-y-2">
                      <Metric label="Deployment frequency" value={`${(stats.hits / Math.max(stats.shots, 1)).toFixed(2)} hits/turn`} />
                      <Metric label="Change failure rate" value={`${changeFailureRate}%`} />
                      <Metric label="Lead time to first sink" value={stats.firstSinkTurn === null ? 'No sink' : `${stats.firstSinkTurn} turns`} />
                      <Metric label="ACUs spent" value={(stats.shots * 0.25).toFixed(2)} />
                      <Metric label="Legacy accuracy" value={`${aiAcc}%`} />
                      <p className="pt-1 text-[0.625rem] text-white/40">Not real DORA. Real ACUs are not billed per torpedo.</p>
                    </dl>
                  )}
                </div>
              </div>
            </div>

            {/* compact session strip: every beat on one track */}
            {beats.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="label-caps !text-[0.6rem] text-accent">Session strip</span>
                  <span className="truncate font-mono text-[0.65rem] text-emerald-300/85">
                    <span className="text-emerald-500/70">LEGACY-MONOLITH&gt; </span>
                    {story?.monolithQuote}
                  </span>
                </div>
                <div className="relative h-6" role="img" aria-label={`Session strip: ${beats.length} key moments over ${lastTurn} turns`}>
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-white/5 via-white/20 to-white/5" />
                  {beats.map((b, i) => (
                    <span
                      key={`${b.title}-${i}`}
                      title={`T${b.turn} · ${b.title}`}
                      className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#07101f] ${BEAT_DOT[b.tone]}`}
                      style={{ left: `${(b.turn / lastTurn) * 96 + 2}%` }}
                    />
                  ))}
                  <span className="num absolute left-0 top-full -mt-0.5 text-[0.55rem] text-white/35">T1</span>
                  <span className="num absolute right-0 top-full -mt-0.5 text-[0.55rem] text-white/35">T{lastTurn}</span>
                </div>
              </div>
            )}
          </div>

          {/* pinned action bar */}
          <footer className="relative flex shrink-0 flex-col-reverse items-center justify-between gap-2 border-t border-white/10 bg-black/25 px-4 py-3 sm:flex-row sm:gap-2.5 sm:px-8">
            <div className="flex items-center gap-3">
              <span className="num whitespace-nowrap text-[0.7rem] text-white/60 sm:text-xs">
                Record vs {info.label}: <strong className="text-white">{rec ? `${rec.wins}W – ${rec.losses}L` : '—'}</strong>
              </span>
              <button
                type="button"
                onClick={copyReport}
                className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-semibold text-accent underline-offset-4 hover:underline"
                aria-live="polite"
              >
                {copied ? 'Copied ✓' : 'Copy report'}
              </button>
            </div>
            <div className="flex w-full flex-wrap justify-center gap-2 sm:w-auto">
              <GlassButton variant="primary" hotkey="Enter" onClick={rematch} className="max-sm:w-full">
                Rematch · same fleet
              </GlassButton>
              <GlassButton hotkey="D" onClick={playAgain} className="max-sm:flex-1">
                <span className="sm:hidden">Difficulty</span>
                <span className="max-sm:hidden">Change difficulty</span>
              </GlassButton>
              <GlassButton hotkey="Esc" onClick={goMenu} className="max-sm:flex-1">
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
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className={`num text-2xl font-bold leading-none ${tone}`}>
        {Math.round(v)}
        <span className="text-base text-white/40">{suffix}</span>
      </div>
      <div className="label-caps mt-1.5 !text-[0.6rem] !tracking-[0.12em]">{label}</div>
    </div>
  );
}

function AccuracyRing({ pct, won }: { pct: number; won: boolean }) {
  const v = useCountUp(pct, 1100, 200);
  const r = 52;
  const len = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-24 w-24 sm:h-32 sm:w-32" role="img" aria-label={`Accuracy ${pct}%`}>
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
        <span className="num text-xl font-extrabold text-white sm:text-3xl">{Math.round(v)}%</span>
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
