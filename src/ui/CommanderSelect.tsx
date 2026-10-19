import { COMMANDERS } from '../game/types';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';

export function CommanderSelect() {
  const commanderId = useGame((s) => s.commanderId);
  const selectCommander = useGame((s) => s.selectCommander);
  const goMenu = useGame((s) => s.goMenu);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6 pointer-events-none">
      <FadeIn className="mb-7 text-center">
        <div className="label-caps mb-2 text-accent">Choose your commander</div>
        <h2 className="title-display text-4xl sm:text-6xl">Who’s on the bridge?</h2>
        <p className="mt-3 text-sm text-white/55">Cosmetic call sign only. No executive powers in the firing solution.</p>
      </FadeIn>

      <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 pointer-events-auto">
        {COMMANDERS.map((commander, index) => {
          const selected = commander.id === commanderId;
          return (
            <FadeIn key={commander.id} delay={0.06 * index}>
              <button
                onClick={() => selectCommander(commander.id)}
                className={`glass glass-opaque glass-interactive group flex h-full min-h-64 w-full flex-col items-start p-5 text-left cursor-pointer ${
                  selected ? 'border-accent/60 bg-accent/10' : ''
                }`}
              >
                <div className="mb-5 flex w-full items-center justify-between">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/25 to-blue-400/10 text-xl font-bold text-accent shadow-[0_0_28px_rgba(34,0,255,0.16)]">
                    {commander.initials}
                  </div>
                  {selected && <span className="label-caps text-accent">Selected</span>}
                </div>
                <span className="text-xl font-semibold tracking-tight text-white">{commander.name}</span>
                <span className="mt-1 min-h-10 text-xs leading-relaxed text-accent">{commander.role}</span>
                <span className="mt-4 text-sm leading-relaxed text-white/60">{commander.tagline}</span>
                <span className="label-caps mt-auto pt-5 !text-[0.55rem] !tracking-[0.16em]">
                  {selected ? 'Continue with commander' : 'Select commander'}
                </span>
              </button>
            </FadeIn>
          );
        })}
      </div>

      <FadeIn delay={0.32} className="mt-6 pointer-events-auto">
        <GlassButton onClick={goMenu}>Back</GlassButton>
      </FadeIn>
      <GlassPanel className="absolute bottom-5 hidden px-4 py-2 sm:block">
        <span className="label-caps !text-[0.55rem] !tracking-[0.15em]">Cognition field exercise · Devin-powered</span>
      </GlassPanel>
    </div>
  );
}
