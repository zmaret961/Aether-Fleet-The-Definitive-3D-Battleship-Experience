import { DIFFICULTY_INFO } from '../game/ai';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';

export function ResultScreen() {
  const stats = useGame((s) => s.stats);
  const playAgain = useGame((s) => s.playAgain);
  const goMenu = useGame((s) => s.goMenu);
  const difficulty = useGame((s) => s.difficulty);

  if (!stats) return null;
  const won = stats.winner === 'player';
  const mins = Math.floor(stats.durationSec / 60);
  const secs = stats.durationSec % 60;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
      <FadeIn className="pointer-events-auto w-full max-w-md">
        <GlassPanel strong className="p-7 sm:p-9 text-center">
          <div className="label-caps mb-2">Battle Report · vs {DIFFICULTY_INFO[difficulty].label}</div>
          <h2 className={`title-display text-4xl sm:text-5xl mb-1 ${won ? '' : 'opacity-80'}`}>
            {won ? 'VICTORY' : 'DEFEAT'}
          </h2>
          <p className="text-white/55 text-sm mb-6">
            {won ? 'Enemy fleet destroyed. The waters are yours.' : 'Your fleet rests in the abyss. Regroup and return.'}
          </p>
          <div className="grid grid-cols-3 gap-3 mb-7">
            {[
              { label: 'Shots', value: stats.shots },
              { label: 'Accuracy', value: `${stats.accuracyPct}%` },
              { label: 'Sunk', value: `${stats.shipsSunk}/5` },
            ].map((s) => (
              <div key={s.label} className="glass rounded-xl py-3">
                <div className="text-xl font-bold text-accent">{s.value}</div>
                <div className="label-caps mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="label-caps mb-6">
            Duration {mins}:{String(secs).padStart(2, '0')}
          </div>
          <div className="flex gap-3 justify-center">
            <GlassButton variant="primary" onClick={playAgain}>
              Play Again
            </GlassButton>
            <GlassButton onClick={goMenu}>Main Menu</GlassButton>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
