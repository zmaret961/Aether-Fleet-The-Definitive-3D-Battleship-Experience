import { DIFFICULTY_INFO } from '../game/ai';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';
import { COMMANDERS } from '../game/types';
import { MatchStoryPanel } from './MatchStory';

export function ResultScreen() {
  const stats = useGame((s) => s.stats);
  const playAgain = useGame((s) => s.playAgain);
  const goMenu = useGame((s) => s.goMenu);
  const rematch = useGame((s) => s.rematch);
  const story = useGame((s) => s.story);
  const difficulty = useGame((s) => s.difficulty);
  const commanderId = useGame((s) => s.commanderId);

  if (!stats) return null;
  const won = stats.winner === 'player';
  const mins = Math.floor(stats.durationSec / 60);
  const secs = stats.durationSec % 60;
  const commander = COMMANDERS.find((entry) => entry.id === commanderId) ?? COMMANDERS[0];
  const changeFailureRate = 100 - stats.accuracyPct;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
      <FadeIn className={`pointer-events-auto w-full ${story ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <GlassPanel strong className="max-h-[calc(100vh-2rem)] overflow-y-auto p-5 text-center sm:px-7 sm:py-6">
          <div className="label-caps mb-2">Field report · vs {DIFFICULTY_INFO[difficulty].label}</div>
          <h2 className={`title-display mb-1 text-4xl sm:text-5xl ${won ? '' : 'opacity-80'}`}>
            {story?.headline ?? (won ? 'Shipped.' : 'Rolled back.')}
          </h2>
          <p className="mb-4 text-sm text-white/55">
            {story?.subhead ??
              (won ? 'Production is green. The backlog is closed.' : 'Rollback complete. Open a fresh branch and regroup.')}
          </p>
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-xs font-bold text-accent">
              {commander.initials}
            </span>
            <span className="text-sm text-white/75">Commanded by <strong className="text-white">{commander.name}</strong></span>
          </div>
          <div className={`mb-4 grid gap-4 text-left ${story ? 'md:grid-cols-2' : ''}`}>
          <div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-2">
            {[
              { label: 'Shots', value: stats.shots },
              { label: 'ACUs spent', value: (stats.shots * 0.25).toFixed(2) },
              { label: 'Accuracy', value: `${stats.accuracyPct}%` },
              { label: 'Tickets closed', value: `${stats.shipsSunk}/5` },
            ].map((s) => (
              <div key={s.label} className="glass rounded-xl px-2 py-3">
                <div className="text-lg font-bold text-accent sm:text-xl">{s.value}</div>
                <div className="label-caps mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <GlassPanel className="p-4 text-left">
            <div className="mb-3 flex items-center justify-between">
              <span className="label-caps text-accent">DORA-style metrics</span>
              <span className="label-caps !text-[0.5rem] !tracking-[0.12em]">Not real DORA</span>
            </div>
            <div className={`grid grid-cols-1 gap-3 ${story ? '' : 'sm:grid-cols-3'}`}>
              <Metric label="Deployment frequency" value={`${(stats.hits / Math.max(stats.shots, 1)).toFixed(2)} hits / turn`} />
              <Metric label="Change failure rate" value={`${changeFailureRate}% miss rate`} />
              <Metric label="Lead time to first sink" value={stats.firstSinkTurn === null ? 'No sink' : `${stats.firstSinkTurn} turns`} />
            </div>
          </GlassPanel>
          </div>
          {story && <MatchStoryPanel story={story} />}
          </div>
          <div className="label-caps mb-4">
            Mission duration {mins}:{String(secs).padStart(2, '0')}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <GlassButton variant="primary" onClick={rematch} autoFocus>
              Rematch · same fleet
            </GlassButton>
            <GlassButton onClick={playAgain}>Change difficulty</GlassButton>
            <GlassButton onClick={goMenu}>Main Menu</GlassButton>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="label-caps mt-1 !text-[0.55rem] !tracking-[0.14em]">{label}</div>
    </div>
  );
}
