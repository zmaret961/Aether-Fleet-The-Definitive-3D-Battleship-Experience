import { DIFFICULTY_INFO } from '../game/ai';
import type { Difficulty } from '../game/ai';
import { useGame } from '../state/store';
import { FadeIn, GlassButton } from './Glass';

const ORDER: Difficulty[] = ['cadet', 'officer', 'commander', 'admiral'];

export function DifficultySelect() {
  const startDeploy = useGame((s) => s.startDeploy);
  const goCommander = useGame((s) => s.goCommander);
  const records = useGame((s) => s.records);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center-safe p-4 sm:p-6 pointer-events-none overflow-y-auto">
      <FadeIn className="text-center mb-6">
        <div className="label-caps mb-2 text-accent">Mission profile</div>
        <h2 className="title-display text-3xl sm:text-5xl">Choose Your Build Failure</h2>
      </FadeIn>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-2xl pointer-events-auto">
        {ORDER.map((d, i) => {
          const info = DIFFICULTY_INFO[d];
          const rec = records[d];
          return (
            <FadeIn key={d} delay={0.08 * i}>
              <button
                className="glass glass-opaque glass-interactive w-full text-left p-5 cursor-pointer group"
                onClick={() => startDeploy(d)}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-lg font-bold text-accent">{info.label}</span>
                  <span className="label-caps">{info.tagline}</span>
                </div>
                <p className="text-sm text-white/60 leading-relaxed">{info.description}</p>
                {rec && (rec.wins + rec.losses) > 0 && (
                  <p className="label-caps mt-3">
                    Record {rec.wins}–{rec.losses}
                  </p>
                )}
              </button>
            </FadeIn>
          );
        })}
      </div>
      <FadeIn delay={0.4} className="mt-6 pointer-events-auto">
        <GlassButton onClick={goCommander}>Back to commanders</GlassButton>
      </FadeIn>
    </div>
  );
}
