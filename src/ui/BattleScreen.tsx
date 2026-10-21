import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DIFFICULTY_INFO } from '../game/ai';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';
import { COMMANDERS, ENEMY_FLEET_NAMES, FLEET } from '../game/types';

const colLetter = (x: number) => String.fromCharCode(65 + x);
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
  const confirmFire = useGame((s) => s.confirmFire);
  const concede = useGame((s) => s.concede);
  const [tip, setTip] = useState<string | null>(null);
  void matchVersion;

  useEffect(() => {
    if (!tip) return;
    const timeout = window.setTimeout(() => setTip(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [tip]);

  if (!match) return null;

  const enemyAlive = match.enemy.ships.filter((s) => !s.sunk).length;
  const playerAlive = match.player.ships.filter((s) => !s.sunk).length;
  const info = DIFFICULTY_INFO[difficulty];
  const commander = COMMANDERS.find((entry) => entry.id === commanderId) ?? COMMANDERS[0];

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-between p-3 sm:p-5">
      {/* top HUD */}
      <FadeIn className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-caps truncate">Field exercise · {info.label}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-[0.65rem] font-semibold tracking-wide text-accent">
              {commander.initials} · {commander.name}
            </span>
            <span className="label-caps !text-[0.55rem]">Target enemy waters</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={lastOutcome?.seq ?? (aiThinking ? 'ai' : 'idle')}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-lg sm:text-2xl font-bold mt-0.5 truncate"
            >
              {aiThinking
                ? 'Legacy is compiling…'
                : lastOutcome
                  ? lastOutcome.text
                  : 'Awaiting your command'}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <GlassPanel className="px-3 py-2 text-right">
            <div className="label-caps">Open tickets</div>
            <div className="text-sm font-semibold">
              <span className="text-accent">{playerAlive}</span>
              <span className="text-white/40"> vs </span>
              <span className="text-danger">{enemyAlive}</span>
            </div>
          </GlassPanel>
          <GlassPanel className="flex max-w-[70vw] items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <span className="label-caps shrink-0 !text-[0.5rem]">Backlog</span>
            {FLEET.map((f) => {
              const ship = match.enemy.ships.find((s) => s.spec.id === f.id);
              const sunk = ship?.sunk;
              const hit = ship ? ship.hits > 0 && !ship.sunk : false;
              return (
                <span
                  key={f.id}
                  className={`rounded-lg border px-1.5 py-1 text-[0.6rem] whitespace-nowrap ${
                    sunk
                      ? 'border-red-400/40 bg-red-400/10 text-red-300 line-through'
                      : hit
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                        : 'border-white/10 bg-white/5 text-white/60'
                  }`}
                >
                  {ENEMY_FLEET_NAMES[f.id]}
                </span>
              );
            })}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* bottom HUD */}
      <FadeIn delay={0.08} className="pointer-events-auto">
        <div className="mx-auto w-full max-w-4xl flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label-caps hidden sm:block">Click a cell to set the firing solution</span>
            <div className="flex-1" />
            <GlassButton onClick={() => setTip(DEEPWIKI_TIPS[Math.floor(Math.random() * DEEPWIKI_TIPS.length)])} className="!px-3 !py-2.5">
              Ask DeepWiki
            </GlassButton>
            <GlassButton onClick={togglePause} className="!px-3 !py-2.5" aria-label="Pause (P)" title="Pause (P)">
              Pause
            </GlassButton>
            <GlassButton onClick={concede} disabled={turnLock || aiThinking} className="!py-2.5">
              Concede
            </GlassButton>
            <GlassButton
              variant="primary"
              className="!px-8 !py-3 text-base"
              disabled={!target || turnLock || aiThinking}
              onClick={confirmFire}
            >
              {target ? `Fire ${colLetter(target.x)}${target.y + 1}` : 'Select target'}
            </GlassButton>
          </div>
        </div>
      </FadeIn>
      <AnimatePresence>
        {tip && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-40 left-1/2 z-50 w-[min(90vw,30rem)] -translate-x-1/2 rounded-2xl border border-accent/25 bg-[#081a2b]/90 px-5 py-4 text-center shadow-2xl backdrop-blur-xl"
          >
            <div className="label-caps mb-2 text-accent">Ask DeepWiki · field note</div>
            <p className="text-sm leading-relaxed text-white/85">{tip}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
