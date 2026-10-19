import { AnimatePresence, motion } from 'framer-motion';
import { DIFFICULTY_INFO } from '../game/ai';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';
import { FLEET } from '../game/types';

const colLetter = (x: number) => String.fromCharCode(65 + x);

export function BattleScreen() {
  const match = useGame((s) => s.match);
  const matchVersion = useGame((s) => s.matchVersion);
  const aiThinking = useGame((s) => s.aiThinking);
  const target = useGame((s) => s.target);
  const turnLock = useGame((s) => s.turnLock);
  const boardView = useGame((s) => s.boardView);
  const lastOutcome = useGame((s) => s.lastOutcome);
  const difficulty = useGame((s) => s.difficulty);
  const confirmFire = useGame((s) => s.confirmFire);
  const setBoardView = useGame((s) => s.setBoardView);
  const goMenu = useGame((s) => s.goMenu);
  void matchVersion;

  if (!match) return null;

  const enemyAlive = match.enemy.ships.filter((s) => !s.sunk).length;
  const playerAlive = match.player.ships.filter((s) => !s.sunk).length;
  const info = DIFFICULTY_INFO[difficulty];

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-between p-4 sm:p-6">
      {/* top HUD */}
      <FadeIn className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-caps truncate">
            {boardView === 'enemy' ? `Enemy waters · ${info.label}` : 'Your fleet'}
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
                ? `${info.label} is calculating a firing solution…`
                : lastOutcome
                  ? lastOutcome.text
                  : 'Awaiting your command'}
            </motion.div>
          </AnimatePresence>
        </div>
        <GlassPanel className="px-4 py-2 text-right shrink-0">
          <div className="label-caps">Fleet strength</div>
          <div className="text-sm font-semibold">
            <span className="text-accent">{playerAlive}</span>
            <span className="text-white/40"> vs </span>
            <span className="text-danger">{enemyAlive}</span>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* bottom HUD */}
      <FadeIn delay={0.08} className="pointer-events-auto">
        <div className="mx-auto w-full max-w-3xl flex flex-col gap-2">
          {/* enemy fleet status */}
          <GlassPanel className="px-3 py-2 flex items-center gap-2 overflow-x-auto">
            <span className="label-caps shrink-0">Enemy</span>
            {FLEET.map((f) => {
              const ship = match.enemy.ships.find((s) => s.spec.id === f.id);
              const sunk = ship?.sunk;
              const hit = ship ? ship.hits > 0 && !ship.sunk : false;
              return (
                <span
                  key={f.id}
                  className={`text-xs px-2 py-1 rounded-lg whitespace-nowrap border ${
                    sunk
                      ? 'border-red-400/40 bg-red-400/10 text-red-300 line-through'
                      : hit
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                        : 'border-white/10 bg-white/5 text-white/60'
                  }`}
                >
                  {f.name}
                </span>
              );
            })}
          </GlassPanel>

          <div className="flex items-center gap-2 flex-wrap">
            {/* view toggle */}
            <GlassPanel className="flex p-1 gap-1">
              {(['enemy', 'player'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setBoardView(v)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    boardView === v ? 'bg-cyan-400/20 text-accent' : 'text-white/55 hover:text-white/80'
                  }`}
                >
                  {v === 'enemy' ? 'Enemy Waters' : 'Your Fleet'}
                </button>
              ))}
            </GlassPanel>
            <div className="flex-1" />
            <GlassButton onClick={goMenu} className="!py-2.5">
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
    </div>
  );
}
