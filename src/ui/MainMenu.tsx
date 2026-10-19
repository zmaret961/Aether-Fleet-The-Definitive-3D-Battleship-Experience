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
      <FadeIn className="mb-5 rounded-3xl border border-white/10 bg-[#06101e]/45 px-8 py-6 text-center shadow-2xl backdrop-blur-xl sm:px-12 sm:py-8">
        <div className="label-caps mb-3 text-accent">Cognition · Field exercise 01</div>
        <h1 className="title-display text-6xl sm:text-8xl mb-2">Aether Fleet</h1>
        <p className="text-white/70 text-sm sm:text-base tracking-wide mb-3">
          A Cognition field exercise — powered by Devin
        </p>
        <p className="label-caps">Autonomous engineering, at sea</p>
      </FadeIn>
      <FadeIn delay={0.15} className="pointer-events-auto">
        <GlassPanel strong className="glass-opaque flex flex-col gap-3 p-6 w-72">
          <GlassButton variant="primary" onClick={goDifficulty}>
            Choose Your Commander
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
      <div className="absolute bottom-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
        <span className="label-caps !text-[0.55rem] !tracking-[0.16em]">FedRAMP High</span>
      </div>
    </div>
  );
}
