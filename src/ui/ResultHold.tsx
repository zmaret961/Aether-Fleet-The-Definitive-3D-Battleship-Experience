import { useEffect } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { RESULT_HOLD_MS, useGame } from '../state/store';

/**
 * Cinematic beat between the deciding shot and the field report: letterbox
 * bars frame the Legacy Monolith's defeat / victory, a thin bar counts down
 * to the report, and any click, tap or key skips straight to it.
 */
export function ResultHold() {
  const pending = useGame((s) => s.resultPending && s.phase === 'battle');
  const won = useGame((s) => s.match?.winner === 'player');
  const conceded = useGame((s) => s.conceded);
  const reveal = useGame((s) => s.revealResult);
  const reduced = useGame((s) => s.settings.reducedMotion);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        reveal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, reveal]);

  const bar = reduced ? { duration: 0 } : { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] as const };
  const title = won ? 'Backlog closed' : conceded ? 'Rollback requested' : 'Fleet rolled back';
  const sub = won ? 'The Legacy Monolith is going offline' : 'The Legacy Monolith keeps its uptime';

  return (
    <AnimatePresence>
      {pending && (
        <m.div
          key="hold"
          className="fixed inset-0 z-30 cursor-pointer"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          onPointerDown={reveal}
          role="button"
          aria-label="Skip to field report"
        >
          <m.div
            className="absolute inset-x-0 top-0 h-[max(9vh,5.75rem)] bg-black/95"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            transition={bar}
            aria-hidden="true"
          />
          <m.div
            className="absolute inset-x-0 bottom-0 flex h-[max(11vh,6.5rem)] flex-col items-center justify-center gap-1.5 bg-black/95"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            transition={bar}
          >
            <div className={`text-sm font-semibold uppercase tracking-[0.32em] ${won ? 'text-success' : 'text-danger'}`}>{title}</div>
            <div className="text-xs text-white/55">
              {sub} · <span className="text-white/80">click or press Space to skip</span>
            </div>
            <div className="mt-1 h-0.5 w-48 overflow-hidden rounded-full bg-white/10">
              <m.div
                className={`h-full ${won ? 'bg-success' : 'bg-danger'}`}
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: RESULT_HOLD_MS / 1000, ease: 'linear' }}
              />
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
