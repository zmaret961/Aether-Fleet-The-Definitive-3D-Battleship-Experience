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

      {/* top-left: commander / mission */}
      <FadeIn from="above" className="absolute left-4 top-4 sm:left-5 sm:top-5">
        <GlassPanel className="glass-hud flex items-center gap-3 py-2.5 pl-2.5 pr-4">
          <CommanderAvatar id={commander.id} size="md" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-white">{commander.name}</div>
            <div className="mt-0.5 text-[0.7rem] text-white/60">
              vs <span className="font-semibold text-danger">{info.label}</span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* top-center: turn indicator + latest outcome */}
      <div className="absolute left-4 right-28 top-4 flex flex-col items-center gap-2 sm:top-5 lg:left-1/2 lg:right-auto lg:w-[30rem] lg:-translate-x-1/2">
        <FadeIn from="above" className="w-full">
          <GlassPanel
            className={`glass-hud flex items-center gap-3 px-4 py-2.5 transition-[border-color,box-shadow] duration-500 ${
              state === 'ai' ? '!border-danger/45 shadow-[0_0_40px_rgba(251,113,133,0.18)]' : state === 'player' || state === 'aim' ? '!border-accent/40 shadow-[0_0_40px_rgba(154,167,255,0.16)]' : ''
            }`}
            role="status"
          >
            <span className={`live-dot ${turnCopy.tone}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[0.95rem] font-bold tracking-tight ${turnCopy.tone}`}>{turnCopy.label}</div>
              <div className="truncate text-[0.7rem] text-white/60">{turnCopy.sub}</div>
            </div>
            <div className="text-right">
              <div className="label-caps !text-[0.625rem]">Turn</div>
              <div className="num text-lg font-bold leading-none text-white">{Math.max(turn, 1)}</div>
            </div>
          </GlassPanel>
          {state === 'ai' && <div className="scan-bar mx-4 -mt-px text-danger" aria-hidden="true" />}
        </FadeIn>
        <div className="h-9" aria-live="polite">
          <AnimatePresence mode="wait">
            {lastOutcome && lastEvent && (
              <motion.div
                key={lastOutcome.seq}
                initial={{ opacity: 0, y: reducedMotion ? 0 : -6, scale: reducedMotion ? 1 : 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className={`chip border-white/15 bg-[#050e1b]/80 px-4 py-1.5 text-sm backdrop-blur-xl ${TONE_CLASS[toneOf(lastEvent)]}`}
              >
                <span className="label-caps !text-[0.625rem] !text-white/55">{lastOutcome.by === 'player' ? 'You' : 'Legacy'}</span>
                <span className="num font-mono text-xs text-white/70">{cellName(lastEvent.coord)}</span>
                <span className="font-semibold">{lastOutcome.text}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* left rail: own fleet */}
      <FadeIn from="left" delay={0.06} className="absolute left-5 top-28 hidden w-64 lg:block xl:w-72">
        <GlassPanel className="glass-hud p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="label-caps text-accent">Your fleet</span>
            <span className="num text-xs text-white/60">
              <span className="font-bold text-white">{playerAfloat}</span>/5 afloat
            </span>
          </div>
          <ul className="space-y-2.5">
            {FLEET.map((f) => (
              <FleetRow key={f.id} name={f.name} length={f.length} ship={match.player.ships.find((s) => s.spec.id === f.id)} own />
            ))}
          </ul>
          <div className="divider my-4" />
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Shots" value={playerShots.length} />
            <MiniStat label="Hits" value={playerHits} accent="text-ember" />
            <MiniStat label="Acc." value={`${accuracy}%`} />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* right rail: enemy backlog + comms */}
      <FadeIn from="right" delay={0.06} className="absolute right-5 top-28 hidden w-64 lg:block xl:w-72">
        <GlassPanel className="glass-hud p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="label-caps text-danger">Enemy backlog</span>
            <span className="num text-xs text-white/60">
              <span className="font-bold text-white">{enemySunk}</span>/5 closed
            </span>
          </div>
          <ul className="space-y-2.5">
            {FLEET.map((f) => (
              <FleetRow key={f.id} name={ENEMY_FLEET_NAMES[f.id]} length={f.length} ship={match.enemy.ships.find((s) => s.spec.id === f.id)} />
            ))}
          </ul>
          <div className="divider my-4" />
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label-caps">Comms log</span>
            <span className="num text-[0.7rem] text-white/50">
              Legacy {aiHits}/{aiShots.length}
            </span>
          </div>
          <ol className="space-y-1.5 text-xs" aria-label="Recent shots">
            {recent.length === 0 && <li className="text-white/50">No traffic yet. Take the first shot.</li>}
            {recent.map((ev, i) => (
              <li key={match.log.length - i} className={`flex items-center gap-2 ${i === 0 ? '' : 'opacity-70'}`}>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${ev.by === 'player' ? 'bg-accent' : 'bg-danger'}`}
                  aria-hidden="true"
                />
                <span className="num w-7 shrink-0 font-mono text-white/60">{cellName(ev.coord)}</span>
                <span className={`truncate font-medium ${TONE_CLASS[toneOf(ev)]}`}>{logLine(ev)}</span>
              </li>
            ))}
          </ol>
        </GlassPanel>
      </FadeIn>

      {/* compact score for narrow screens */}
      <FadeIn from="above" className="absolute right-4 top-4 lg:hidden">
        <GlassPanel className="glass-hud px-3 py-2 text-right">
          <div className="label-caps !text-[0.625rem]">Afloat</div>
          <div className="num text-sm font-bold">
            <span className="text-accent">{playerAfloat}</span>
            <span className="text-white/45"> vs </span>
            <span className="text-danger">{5 - enemySunk}</span>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* bottom: fire control dock */}
      <FadeIn delay={0.1} className="absolute inset-x-0 bottom-4 flex justify-center px-3 sm:bottom-5">
        <GlassPanel strong className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl p-2.5 pl-4">
          <div className="hidden min-w-0 flex-1 sm:block">
            <div className="label-caps !text-[0.625rem]">Firing solution</div>
            <div className="flex items-baseline gap-2">
              <span className={`num font-mono text-2xl font-bold ${target ? 'text-white' : 'text-white/30'}`}>
                {target ? cellName(target) : '—'}
              </span>
              <span className="truncate text-xs text-white/55">
                {target ? (
                  <>
                    <Kbd>Enter</Kbd> to fire
                  </>
                ) : (
                  <>
                    Click a cell or use <Kbd>←</Kbd>
                    <Kbd>→</Kbd>
                  </>
                )}
              </span>
            </div>
          </div>
          <GlassButton onClick={askDeepWiki} hotkey="Q" className="!px-3.5 !py-2.5">
            Ask DeepWiki
          </GlassButton>
          <GlassButton
            variant={confirmConcede ? 'danger' : 'ghost'}
            onClick={() => (confirmConcede ? concede() : setConfirmConcede(true))}
            disabled={turnLock || aiThinking}
            className="!px-3.5 !py-2.5"
          >
            {confirmConcede ? 'Confirm concede' : 'Concede'}
          </GlassButton>
          <GlassButton
            variant="primary"
            className="!px-7 !py-3 text-base"
            disabled={!target || turnLock || aiThinking}
            onClick={confirmFire}
            aria-label={target ? `Fire at ${cellName(target)}` : 'Select a target first'}
          >
            {target ? `Fire ${cellName(target)}` : aiThinking ? 'Enemy turn' : 'Select target'}
          </GlassButton>
        </GlassPanel>
      </FadeIn>

      <AnimatePresence>
        {tip && (
          <motion.div
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
            className="glass glass-strong absolute bottom-28 left-1/2 z-50 w-[min(90vw,32rem)] -translate-x-1/2 px-5 py-4"
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
  const statusClass = sunk ? (own ? 'text-danger' : 'text-success') : own && hits > 0 ? 'text-ember' : 'text-white/50';
  return (
    <li className={sunk ? 'opacity-75' : ''}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`truncate text-[0.8rem] font-semibold ${sunk ? 'text-white/55 line-through decoration-danger/70' : 'text-white'}`}>{name}</span>
        <span className={`text-[0.625rem] font-semibold uppercase tracking-[0.14em] ${statusClass}`}>{status}</span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={`pip !h-1 ${pipClass(i)}`} />
        ))}
      </div>
    </li>
  );
}

function MiniStat({ label, value, accent = 'text-white' }: { label: string; value: number | string; accent?: string }) {
  return (
    <div>
      <div className={`num text-lg font-bold leading-tight ${accent}`}>{value}</div>
      <div className="label-caps !text-[0.625rem] !tracking-[0.12em]">{label}</div>
    </div>
  );
}
