import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DIFFICULTY_INFO } from '../game/ai';
import type { ShotEvent } from '../game/engine';
import { useGame } from '../state/store';
import { fx } from '../state/fx';
import { FadeIn, GlassButton, GlassPanel, Kbd } from './Glass';
import { CommanderAvatar } from './CommanderAvatar';
import { COMMANDERS, ENEMY_FLEET_NAMES, FLEET, GRID_SIZE, shipSpec } from '../game/types';
import type { Coord, PlacedShip } from '../game/types';
import { useHotkeys } from './hotkeys';
import { cellName } from './theme';

const DEEPWIKI_TIPS = [
  'Playbooks are reusable instructions for repeatable work—write the setup once, then let Devin follow it.',
  'Knowledge keeps durable team context close: conventions, architecture notes, and the “why” behind your code.',
  'MCP is a standard way to connect Devin to tools and data sources with scoped, explicit integrations.',
  'ACUs measure Devin usage; they are not a count of tokens or a measure of code quality.',
  'SWE-bench evaluates real software issue resolution. A benchmark score is useful context, not a production guarantee.',
  'Devin Review helps teams inspect and improve AI-generated code before it lands.',
  'DeepWiki turns a repository into a browsable, explainable knowledge base. Ask about architecture, not secret coordinates.',
  'An agent harness is the tools, feedback loops, and guardrails around an agent—the right harness makes work repeatable.',
  'A context window is finite working memory. Clear tasks and durable project Knowledge help preserve the important bits.',
  'Devin Oncall can investigate incidents from operational context; humans still own the decision to ship a fix.',
];

const DIRS: Record<string, Coord> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

type Tone = 'hit' | 'sunk' | 'miss' | 'threat';

const toneOf = (ev: ShotEvent): Tone => {
  const k = ev.outcome.kind;
  if (ev.by === 'ai') return k === 'miss' ? 'miss' : 'threat';
  return k === 'miss' ? 'miss' : k === 'hit' ? 'hit' : 'sunk';
};

const TONE_CLASS: Record<Tone, string> = {
  hit: 'text-ember',
  sunk: 'text-success',
  miss: 'text-white/80',
  threat: 'text-danger',
};

const logLine = (ev: ShotEvent) => {
  const o = ev.outcome;
  if (ev.by === 'player') {
    if (o.kind === 'miss') return 'CI failed';
    if (o.kind === 'hit') return 'PR merged';
    if ('shipId' in o) return `Closed ${ENEMY_FLEET_NAMES[o.shipId]}`;
  } else {
    if (o.kind === 'miss') return 'Build failed';
    if ('shipId' in o) return `${o.kind === 'hit' ? 'Regression in' : 'Lost'} ${shipSpec(o.shipId).name}`;
  }
  return '';
};

export function BattleScreen() {
  const match = useGame((s) => s.match);
  const togglePause = useGame((s) => s.togglePause);
  const matchVersion = useGame((s) => s.matchVersion);
  const aiThinking = useGame((s) => s.aiThinking);
  const target = useGame((s) => s.target);
  const turnLock = useGame((s) => s.turnLock);
  const lastOutcome = useGame((s) => s.lastOutcome);
  const difficulty = useGame((s) => s.difficulty);
  const commanderId = useGame((s) => s.commanderId);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const confirmFire = useGame((s) => s.confirmFire);
  const aimAt = useGame((s) => s.aimAt);
  const concede = useGame((s) => s.concede);
  const [tip, setTip] = useState<string | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);
  const [flash, setFlash] = useState(0);
  const cursor = useRef<Coord>({ x: 4, y: 4 });
  void matchVersion;

  useEffect(() => {
    if (!tip) return;
    const timeout = window.setTimeout(() => setTip(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [tip]);

  useEffect(() => {
    if (!confirmConcede) return;
    const timeout = window.setTimeout(() => setConfirmConcede(false), 3500);
    return () => window.clearTimeout(timeout);
  }, [confirmConcede]);

  // Red edge pulse when Legacy lands a hit on our fleet.
  useEffect(
    () =>
      fx.subscribe((e) => {
        if (e.type === 'explosion' && e.side === 'player') setFlash((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    if (target) cursor.current = target;
  }, [target]);

  const askDeepWiki = () => setTip(DEEPWIKI_TIPS[Math.floor(Math.random() * DEEPWIKI_TIPS.length)]);

  const nudge = (d: Coord) => {
    const m = useGame.getState().match;
    if (!m) return;
    let { x, y } = target ?? cursor.current;
    if (!target && m.enemy.marks[y][x] === 'unknown') {
      aimAt({ x, y });
      return;
    }
    for (let i = 0; i < GRID_SIZE; i++) {
      x += d.x;
      y += d.y;
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return;
      if (m.enemy.marks[y][x] === 'unknown') {
        cursor.current = { x, y };
        aimAt({ x, y });
        return;
      }
    }
  };

  useHotkeys({
    ...Object.fromEntries(Object.entries(DIRS).map(([k, d]) => [k, () => nudge(d)])),
    ' ': () => {
      if (target) confirmFire();
    },
    q: askDeepWiki,
    Escape: () => {
      if (tip) setTip(null);
      else useGame.setState({ target: null });
    },
  });

  if (!match) return null;

  const info = DIFFICULTY_INFO[difficulty];
  const commander = COMMANDERS.find((entry) => entry.id === commanderId) ?? COMMANDERS[0];
  const playerShots = match.log.filter((e) => e.by === 'player');
  const playerHits = playerShots.filter((e) => e.outcome.kind !== 'miss').length;
  const aiShots = match.log.filter((e) => e.by === 'ai');
  const aiHits = aiShots.filter((e) => e.outcome.kind !== 'miss').length;
  const accuracy = playerShots.length ? Math.round((playerHits / playerShots.length) * 100) : 0;
  const enemySunk = match.enemy.ships.filter((s) => s.sunk).length;
  const playerAfloat = match.player.ships.filter((s) => !s.sunk).length;
  const turn = playerShots.length + (match.turn === 'player' && !turnLock ? 1 : 0);
  const lastEvent = match.log[match.log.length - 1];
  const recent = match.log.slice(-6).reverse();
  const firing = turnLock && !aiThinking && !match.winner;

  const state: 'player' | 'aim' | 'firing' | 'ai' | 'over' = match.winner
    ? 'over'
    : aiThinking
      ? 'ai'
      : firing
        ? 'firing'
        : target
          ? 'aim'
          : 'player';

  const turnCopy = {
    player: { label: 'Your move', sub: 'Pick a cell on the enemy grid', tone: 'text-accent' },
    aim: { label: `Solution locked · ${target ? cellName(target) : ''}`, sub: 'Fire when ready', tone: 'text-accent' },
    firing: { label: 'Missile away', sub: 'Awaiting telemetry…', tone: 'text-ember' },
    ai: { label: 'Legacy is compiling…', sub: 'Enemy turn · brace for regressions', tone: 'text-danger' },
    over: { label: match.winner === 'player' ? 'Backlog closed' : 'Fleet lost', sub: 'Compiling field report…', tone: match.winner === 'player' ? 'text-success' : 'text-danger' },
  }[state];

  const outcomeChip = (
    <div className="flex h-8 justify-center" aria-live="polite">
      <AnimatePresence mode="wait">
        {lastOutcome && lastEvent && (
          <motion.div
            key={lastOutcome.seq}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 6, scale: reducedMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={`chip max-w-full whitespace-nowrap border-white/15 bg-[#050e1b]/85 px-3.5 py-1 text-[0.8rem] backdrop-blur-xl ${TONE_CLASS[toneOf(lastEvent)]}`}
          >
            <span className="label-caps !text-[0.575rem] !text-white/55">{lastOutcome.by === 'player' ? 'You' : 'Legacy'}</span>
            <span className="num font-mono text-xs text-white/70">{cellName(lastEvent.coord)}</span>
            <span className="truncate font-semibold">{lastOutcome.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const bannerGlow =
    state === 'ai'
      ? '!border-danger/45 shadow-[0_0_32px_rgba(251,113,133,0.18)]'
      : state === 'player' || state === 'aim'
        ? '!border-accent/40 shadow-[0_0_32px_rgba(154,167,255,0.16)]'
        : '';

  return (
    <div className="fixed inset-0 pointer-events-none">
      {/* damage pulse */}
      <AnimatePresence>
        {flash > 0 && !reducedMotion && (
          <motion.div
            key={flash}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            className="absolute inset-0 shadow-[inset_0_0_140px_rgba(251,113,133,0.55)]"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* ---------- compact two-row HUD (phones + tablets) ---------- */}
      <FadeIn from="above" className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
        <GlassPanel className={`glass-hud px-2.5 py-2 transition-[border-color,box-shadow] duration-500 ${bannerGlow}`} role="status">
          <div className="flex items-center gap-2.5">
            <CommanderAvatar id={commander.id} size="sm" />
            <span className={`live-dot ${turnCopy.tone}`} aria-hidden="true" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className={`truncate text-sm font-bold tracking-tight ${turnCopy.tone}`}>{turnCopy.label}</div>
              <div className="truncate text-[0.68rem] text-white/55">{turnCopy.sub}</div>
            </div>
            <div className="shrink-0 text-right leading-none">
              <div className="label-caps !text-[0.55rem]">Turn</div>
              <div className="num mt-0.5 text-base font-bold text-white">{Math.max(turn, 1)}</div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/8 pt-2">
            <FleetGauge label="Fleet" tone="text-accent" value={`${playerAfloat}/5`} ships={match.player.ships} own />
            <FleetGauge label="Backlog" tone="text-danger" value={`${enemySunk}/5`} ships={match.enemy.ships} />
          </div>
        </GlassPanel>
        {state === 'ai' && <div className="scan-bar mx-4 -mt-px text-danger" aria-hidden="true" />}
      </FadeIn>

      {/* ---------- desktop: commander chip ---------- */}
      <FadeIn from="above" className="absolute left-5 top-5 hidden lg:block">
        <GlassPanel className="glass-hud flex w-60 items-center gap-3 py-2 pl-2 pr-4 xl:w-64">
          <CommanderAvatar id={commander.id} size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight text-white">{commander.name}</div>
            <div className="mt-0.5 truncate text-[0.7rem] text-white/60">
              vs <span className="font-semibold text-danger">{info.label}</span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ---------- desktop: compact turn banner ---------- */}
      <FadeIn from="above" className="absolute left-1/2 top-5 hidden w-[19rem] -translate-x-1/2 lg:block">
        <GlassPanel className={`glass-hud flex items-center gap-3 px-4 py-2 transition-[border-color,box-shadow] duration-500 ${bannerGlow}`} role="status">
          <span className={`live-dot ${turnCopy.tone}`} aria-hidden="true" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className={`truncate text-[0.9rem] font-bold tracking-tight ${turnCopy.tone}`}>{turnCopy.label}</div>
            <div className="truncate text-[0.68rem] text-white/55">{turnCopy.sub}</div>
          </div>
          <div className="flex items-baseline gap-1.5 border-l border-white/10 pl-3">
            <span className="label-caps !text-[0.55rem]">Turn</span>
            <span className="num text-lg font-bold leading-none text-white">{Math.max(turn, 1)}</span>
          </div>
        </GlassPanel>
        {state === 'ai' && <div className="scan-bar mx-4 -mt-px text-danger" aria-hidden="true" />}
      </FadeIn>

      {/* ---------- desktop: own fleet rail ---------- */}
      <FadeIn from="left" delay={0.06} className="absolute left-5 top-[5.25rem] hidden w-60 lg:block xl:w-64">
        <GlassPanel className="glass-hud px-3.5 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label-caps !text-[0.625rem] text-accent">Your fleet</span>
            <span className="num text-[0.7rem] text-white/60">
              <span className="font-bold text-white">{playerAfloat}</span>/5 afloat
            </span>
          </div>
          <ul className="space-y-1.5">
            {FLEET.map((f) => (
              <FleetRow key={f.id} name={f.name} length={f.length} ship={match.player.ships.find((s) => s.spec.id === f.id)} own />
            ))}
          </ul>
          <div className="mt-2.5 grid grid-cols-3 gap-1 border-t border-white/8 pt-2 text-center">
            <MiniStat label="Shots" value={playerShots.length} />
            <MiniStat label="Hits" value={playerHits} accent="text-ember" />
            <MiniStat label="Acc." value={`${accuracy}%`} />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ---------- desktop: enemy backlog + comms rail ---------- */}
      <FadeIn from="right" delay={0.06} className="absolute right-5 top-5 hidden w-60 lg:block xl:w-64">
        <GlassPanel className="glass-hud px-3.5 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label-caps !text-[0.625rem] text-danger">Enemy backlog</span>
            <span className="num text-[0.7rem] text-white/60">
              <span className="font-bold text-white">{enemySunk}</span>/5 closed
            </span>
          </div>
          <ul className="space-y-1.5">
            {FLEET.map((f) => (
              <FleetRow key={f.id} name={ENEMY_FLEET_NAMES[f.id]} length={f.length} ship={match.enemy.ships.find((s) => s.spec.id === f.id)} />
            ))}
          </ul>
          <div className="mt-2.5 border-t border-white/8 pt-2">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="label-caps !text-[0.575rem]">Comms log</span>
              <span className="num text-[0.65rem] text-white/50">
                Legacy {aiHits}/{aiShots.length}
              </span>
            </div>
            <ol className="space-y-1 text-[0.7rem]" aria-label="Recent shots">
              {recent.length === 0 && <li className="text-white/50">No traffic yet. Take the first shot.</li>}
              {recent.map((ev, i) => (
                <li key={match.log.length - i} className={`flex items-center gap-2 ${i === 0 ? '' : 'opacity-65'}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ev.by === 'player' ? 'bg-accent' : 'bg-danger'}`} aria-hidden="true" />
                  <span className="num w-7 shrink-0 font-mono text-white/60">{cellName(ev.coord)}</span>
                  <span className={`truncate font-medium ${TONE_CLASS[toneOf(ev)]}`}>{logLine(ev)}</span>
                </li>
              ))}
            </ol>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ---------- bottom: latest outcome + fire control dock ---------- */}
      <FadeIn
        delay={0.1}
        className="absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-1.5 px-3 sm:bottom-5"
      >
        {outcomeChip}
        <GlassPanel strong className="pointer-events-auto flex w-full max-w-[44rem] items-center gap-2 rounded-2xl p-2 sm:gap-2.5 sm:p-2.5 sm:pl-4">
          <div className="hidden shrink-0 items-center gap-3 pr-1 sm:flex">
            <div className="leading-tight">
              <div className="label-caps !text-[0.575rem]">Target</div>
              <div className={`num w-12 font-mono text-2xl font-bold leading-none ${target ? 'text-white' : 'text-white/30'}`}>
                {target ? cellName(target) : '—'}
              </div>
            </div>
            <div className="whitespace-nowrap text-[0.7rem] leading-snug text-white/55">
              {target ? (
                <>
                  <Kbd>Enter</Kbd> fire
                  <br />
                  <Kbd>Esc</Kbd> clear
                </>
              ) : (
                <>
                  Click a cell
                  <br />
                  or aim with <Kbd>↑↓←→</Kbd>
                </>
              )}
            </div>
          </div>
          <div className="hidden flex-1 sm:block" />
          <GlassButton onClick={togglePause} className="shrink-0 whitespace-nowrap !px-3 !py-2.5" aria-label="Pause (P)" title="Pause (P)">
            Pause
          </GlassButton>
          <GlassButton onClick={askDeepWiki} hotkey="Q" className="shrink-0 whitespace-nowrap !px-3 !py-2.5" aria-label="Ask DeepWiki (Q)">
            <span className="sm:hidden">DeepWiki</span>
            <span className="hidden sm:inline">Ask DeepWiki</span>
          </GlassButton>
          <GlassButton
            variant={confirmConcede ? 'danger' : 'ghost'}
            onClick={() => (confirmConcede ? concede() : setConfirmConcede(true))}
            disabled={turnLock || aiThinking}
            className="shrink-0 whitespace-nowrap !px-3 !py-2.5"
          >
            {confirmConcede ? 'Confirm?' : 'Concede'}
          </GlassButton>
          <GlassButton
            variant="primary"
            className="min-w-0 flex-1 whitespace-nowrap !px-4 !py-3 text-base sm:min-w-[9.5rem] sm:flex-none sm:!px-6"
            disabled={!target || turnLock || aiThinking}
            onClick={confirmFire}
            aria-label={target ? `Fire at ${cellName(target)}` : 'Select a target first'}
          >
            {target ? `Fire ${cellName(target)}` : aiThinking ? 'Enemy turn' : firing ? 'Inbound…' : 'Pick target'}
          </GlassButton>
        </GlassPanel>
      </FadeIn>

      <AnimatePresence>
        {tip && (
          <motion.div
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
            className="glass glass-strong absolute bottom-32 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 px-5 py-4"
            role="status"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="label-caps text-accent">Ask DeepWiki · field note</span>
              <span className="text-[0.7rem] text-white/50">
                <Kbd>Esc</Kbd> dismiss
              </span>
            </div>
            <p className="text-sm leading-relaxed text-white/85">{tip}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FleetRow({ name, length, ship, own = false }: { name: string; length: number; ship?: PlacedShip; own?: boolean }) {
  const sunk = ship?.sunk ?? false;
  const hits = ship?.hits ?? 0;
  // Enemy damage stays hidden until a ship sinks, like the tabletop game.
  const pipClass = (i: number) =>
    sunk ? 'pip-dead' : own ? (i < hits ? 'pip-hit' : 'pip-ok') : 'pip-accent opacity-70';
  const status = sunk ? (own ? 'Lost' : 'Closed') : own && hits > 0 ? 'Damaged' : own ? 'Nominal' : 'Open';
  const statusClass = sunk ? (own ? 'text-danger' : 'text-success') : own && hits > 0 ? 'text-ember' : 'text-white/45';
  return (
    <li className={sunk ? 'opacity-75' : ''}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className={`truncate text-[0.75rem] font-semibold ${sunk ? 'text-white/55 line-through decoration-danger/70' : 'text-white'}`}>{name}</span>
        <span className={`text-[0.55rem] font-semibold uppercase tracking-[0.14em] ${statusClass}`}>{status}</span>
      </div>
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={`pip !h-[3px] ${pipClass(i)}`} />
        ))}
      </div>
    </li>
  );
}

/** One-line fleet summary for the compact HUD: a bar per ship, sized by length. */
function FleetGauge({ label, tone, value, ships, own = false }: { label: string; tone: string; value: string; ships: PlacedShip[]; own?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className={`label-caps !text-[0.55rem] ${tone}`}>{label}</span>
        <span className="num text-[0.65rem] text-white/60">
          <span className="font-bold text-white">{value.split('/')[0]}</span>/5 {own ? 'afloat' : 'closed'}
        </span>
      </div>
      <div className="flex gap-0.5" aria-hidden="true">
        {FLEET.map((f) => {
          const s = ships.find((p) => p.spec.id === f.id);
          const cls = s?.sunk ? 'pip-dead' : own ? ((s?.hits ?? 0) > 0 ? 'pip-hit' : 'pip-ok') : 'pip-accent opacity-70';
          return <span key={f.id} className={`pip !h-1 ${cls}`} style={{ flexGrow: f.length }} />;
        })}
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent = 'text-white' }: { label: string; value: number | string; accent?: string }) {
  return (
    <div>
      <div className={`num text-base font-bold leading-tight ${accent}`}>{value}</div>
      <div className="label-caps !text-[0.55rem] !tracking-[0.12em]">{label}</div>
    </div>
  );
}
