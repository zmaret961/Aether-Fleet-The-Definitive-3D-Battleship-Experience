import { COMMANDERS } from '../game/types';
import { useGame } from '../state/store';
import { CommanderAvatar } from './CommanderAvatar';
import { FadeIn, GlassButton, Kbd, KeyHint, ScreenHeader } from './Glass';
import { useHotkeys } from './hotkeys';
import { COMMANDER_HUES } from './theme';

export function CommanderSelect() {
  const commanderId = useGame((s) => s.commanderId);
  const selectCommander = useGame((s) => s.selectCommander);
  const goMenu = useGame((s) => s.goMenu);

  useHotkeys({
    '1': () => selectCommander(COMMANDERS[0].id),
    '2': () => selectCommander(COMMANDERS[1].id),
    '3': () => selectCommander(COMMANDERS[2].id),
    '4': () => selectCommander(COMMANDERS[3].id),
    Enter: () => selectCommander(commanderId),
    Escape: goMenu,
  });

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center-safe overflow-y-auto p-4 sm:p-6 pointer-events-none">
      <div className="vignette absolute inset-0" aria-hidden="true" />
      <FadeIn className="relative mb-8">
        <ScreenHeader
          eyebrow="Step 1 of 3 · Commander"
          title="Who’s on the bridge?"
          subtitle="Cosmetic call sign only. No executive powers in the firing solution."
        />
      </FadeIn>

      <div
        role="radiogroup"
        aria-label="Commander"
        className="relative grid w-full max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 pointer-events-auto"
      >
        {COMMANDERS.map((commander, index) => {
          const selected = commander.id === commanderId;
          const hue = COMMANDER_HUES[commander.id];
          return (
            <FadeIn key={commander.id} delay={0.05 * index + 0.08}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-keyshortcuts={String(index + 1)}
                onClick={() => selectCommander(commander.id)}
                className="glass glass-opaque glass-interactive group flex h-full min-h-72 w-full cursor-pointer flex-col items-start overflow-hidden p-6 text-left"
                style={
                  selected
                    ? {
                        borderColor: hue.from,
                        boxShadow: `0 0 0 1px ${hue.from}55, 0 24px 60px rgba(0,0,0,0.5), 0 0 50px ${hue.glow}`,
                      }
                    : undefined
                }
              >
                <div
                  className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-50"
                  style={{ background: hue.to }}
                  aria-hidden="true"
                />
                <div className="mb-6 flex w-full items-start justify-between">
                  <CommanderAvatar id={commander.id} size="lg" />
                  {selected ? (
                    <span className="chip border-white/20 bg-white/10 text-white">
                      <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Last used
                    </span>
                  ) : (
                    <Kbd>{index + 1}</Kbd>
                  )}
                </div>
                <span className="text-2xl font-bold tracking-tight text-white">{commander.name}</span>
                <span className="mt-1.5 min-h-10 text-xs font-medium leading-relaxed" style={{ color: hue.from }}>
                  {commander.role}
                </span>
                <span className="mt-3 text-sm leading-relaxed text-white/70">{commander.tagline}</span>
                <span className="mt-auto flex w-full items-center justify-between pt-6 text-xs font-semibold text-white/60 transition-colors group-hover:text-white">
                  <span className="uppercase tracking-[0.16em]">Take command</span>
                  <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              </button>
            </FadeIn>
          );
        })}
      </div>

      <FadeIn delay={0.3} className="relative mt-8 flex flex-col items-center gap-3 pointer-events-auto">
        <GlassButton hotkey="Esc" onClick={goMenu}>
          Back
        </GlassButton>
        <KeyHint keys={['1', '–', '4']}>pick a commander</KeyHint>
      </FadeIn>
    </div>
  );
}
