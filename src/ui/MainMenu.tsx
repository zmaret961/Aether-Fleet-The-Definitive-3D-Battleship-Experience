import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';

export function MainMenu() {
  const goDifficulty = useGame((s) => s.goDifficulty);
  const goHowTo = useGame((s) => s.goHowTo);
  const setSettingsOpen = useGame((s) => s.setSettingsOpen);
  const records = useGame((s) => s.records);

  const totalWins = Object.values(records).reduce((n, r) => n + (r?.wins ?? 0), 0);
  const totalGames = Object.values(records).reduce((n, r) => n + (r?.wins ?? 0) + (r?.losses ?? 0), 0);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 pointer-events-none">
      <FadeIn className="text-center">
        <div className="label-caps mb-3">Deep-Sea Command Interface</div>
        <h1 className="title-display text-5xl sm:text-7xl mb-2">AETHER FLEET</h1>
        <p className="text-white/55 text-sm sm:text-base tracking-wide mb-10">
          A cinematic 3D Battleship experience
        </p>
      </FadeIn>
      <FadeIn delay={0.15} className="pointer-events-auto">
        <GlassPanel strong className="flex flex-col gap-3 p-6 w-72">
          <GlassButton variant="primary" onClick={goDifficulty}>
            Deploy Fleet
          </GlassButton>
          <GlassButton onClick={goHowTo}>How to Play</GlassButton>
          <GlassButton onClick={() => setSettingsOpen(true)}>Settings</GlassButton>
          {totalGames > 0 && (
            <div className="text-center label-caps pt-2">
              Service record · {totalWins}W / {totalGames - totalWins}L
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
