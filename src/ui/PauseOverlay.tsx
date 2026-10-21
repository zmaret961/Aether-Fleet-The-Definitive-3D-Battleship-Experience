import { AnimatePresence, m } from 'framer-motion';
import { DIFFICULTY_INFO } from '../game/ai';
import { formatClock, missionElapsedMs, useGame } from '../state/store';
import { GlassButton, GlassPanel } from './Glass';

export function PauseOverlay() {
  const paused = useGame((s) => s.paused);
  const phase = useGame((s) => s.phase);
  const resume = useGame((s) => s.resumeGame);
  const goMenu = useGame((s) => s.goMenu);
  const concede = useGame((s) => s.concede);
  const setSettingsOpen = useGame((s) => s.setSettingsOpen);
  const difficulty = useGame((s) => s.difficulty);
  const match = useGame((s) => s.match);

  const shots = match?.log.filter((e) => e.by === 'player').length ?? 0;
  const closed = match?.enemy.ships.filter((s) => s.sunk).length ?? 0;

  return (
    <AnimatePresence>
      {paused && phase === 'battle' && (
        <m.div
          key="pause"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#020812]/60 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Paused"
        >
          <m.div
            initial={{ scale: 0.95, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <GlassPanel strong className="glass-opaque w-[22rem] max-w-[calc(100vw-2rem)] p-6 text-center">
              <div className="label-caps mb-2 text-accent">Session paused · vs {DIFFICULTY_INFO[difficulty].label}</div>
              <h3 className="title-display mb-1 text-4xl">Paused</h3>
              <p className="mb-3 text-xs text-white/55">Devin is idle. No ACUs are being consumed.</p>
              <dl className="mb-5 grid grid-cols-3 gap-2 text-center">
                {[
                  ['Shots', String(shots)],
                  ['Tickets', `${closed}/5`],
                  ['Mission', formatClock(missionElapsedMs() / 1000)],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col-reverse rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
                    <dt className="label-caps !text-[0.5rem]">{k}</dt>
                    <dd className="num text-sm font-semibold text-white">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-2.5">
                <GlassButton variant="primary" onClick={resume} autoFocus>
                  Resume session
                </GlassButton>
                <GlassButton onClick={() => setSettingsOpen(true)}>Settings</GlassButton>
                <GlassButton onClick={concede}>Concede match</GlassButton>
                <GlassButton onClick={goMenu}>Abandon to main menu</GlassButton>
              </div>
              <div className="label-caps mt-4 !text-[0.55rem]">P or Esc to resume</div>
            </GlassPanel>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
