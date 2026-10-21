import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { COMMANDERS } from '../game/types';
import { useGame } from '../state/store';
import { CommanderEmblem, RankChevrons } from './CommanderAvatar';
import { FadeIn, GlassButton, Kbd, KeyHint, ScreenHeader } from './Glass';
import { useHotkeys } from './hotkeys';
import { COMMANDER_CARDS, COMMANDER_HUES } from './theme';

/** Pointer-driven tilt + holo glare. Writes CSS vars straight to the element so hover never re-renders React. */
const onTilt = (e: ReactPointerEvent<HTMLElement>, reduced: boolean) => {
  if (reduced || e.pointerType === 'touch') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  el.style.setProperty('--rx', `${(0.5 - py) * 12}deg`);
  el.style.setProperty('--ry', `${(px - 0.5) * 14}deg`);
  el.style.setProperty('--mx', `${px * 100}%`);
  el.style.setProperty('--my', `${py * 100}%`);
  el.style.setProperty('--shine', '1');
};
const onTiltEnd = (e: ReactPointerEvent<HTMLElement>) => {
  const el = e.currentTarget;
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
  el.style.setProperty('--shine', '0');
};

export function CommanderSelect() {
  const commanderId = useGame((s) => s.commanderId);
  const selectCommander = useGame((s) => s.selectCommander);
  const goMenu = useGame((s) => s.goMenu);
  const reduced = useGame((s) => s.settings.reducedMotion);

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
      <FadeIn className="relative mb-6 lg:mb-7">
        <ScreenHeader
          eyebrow="Step 1 of 3 · Commander"
          title="Who’s on the bridge?"
          subtitle="Pick your card. Cosmetic call sign only: no executive powers in the firing solution."
          subtitleClassName="sm:max-w-none sm:whitespace-nowrap"
        />
      </FadeIn>

      <div
        role="radiogroup"
        aria-label="Commander"
        className="relative grid w-full max-w-6xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 pointer-events-auto"
      >
        {COMMANDERS.map((commander, index) => {
          const selected = commander.id === commanderId;
          const hue = COMMANDER_HUES[commander.id];
          const card = COMMANDER_CARDS[commander.id];
          return (
            <FadeIn key={commander.id} delay={0.06 * index + 0.08}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-keyshortcuts={String(index + 1)}
                aria-label={`${commander.name}, ${commander.role}. Call sign ${card.callSign}.`}
                onClick={() => selectCommander(commander.id)}
                onPointerMove={(e) => onTilt(e, reduced)}
                onPointerLeave={onTiltEnd}
                className={`holo-card group flex h-full w-full cursor-pointer flex-col text-left ${selected ? 'is-selected' : ''}`}
                style={{ '--hue-from': hue.from, '--hue-to': hue.to, '--hue-glow': hue.glow } as CSSProperties}
              >
                {/* art window */}
                <div className="holo-art relative flex h-40 items-center justify-center overflow-hidden rounded-[0.9rem] sm:h-44 lg:h-[10.5rem]">
                  <div className="holo-art-grid absolute inset-0" aria-hidden="true" />
                  <div
                    className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-90"
                    style={{ background: hue.to, opacity: selected ? 0.7 : 0.45 }}
                    aria-hidden="true"
                  />
                  <CommanderEmblem id={commander.id} className="holo-emblem relative h-28 w-28 sm:h-32 sm:w-32" />
                  <div className="absolute left-3 top-3 flex items-center gap-1.5">
                    <span className="num font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-white/70">No.{card.serial}/04</span>
                  </div>
                  <div className="absolute right-3 top-2.5">
                    <RankChevrons count={card.chevrons} star={card.star} color={hue.from} className="w-6 drop-shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
                    <span className="text-[0.625rem] font-bold uppercase tracking-[0.24em]" style={{ color: hue.from }}>
                      “{card.callSign}”
                    </span>
                    {selected ? (
                      <span className="chip !py-0.5 border-white/25 bg-white/15 text-white">
                        <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        On deck
                      </span>
                    ) : (
                      <Kbd>{index + 1}</Kbd>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col px-1.5 pb-1 pt-4">
                  <span className="text-[1.375rem] font-bold leading-tight tracking-tight text-white">{commander.name}</span>
                  <span className="mt-1 min-h-8 text-[0.7rem] font-semibold uppercase leading-snug tracking-[0.12em]" style={{ color: hue.from }}>
                    {commander.role}
                  </span>
                  <span className="mt-2 text-sm leading-relaxed text-white/75">{commander.tagline}</span>
                  <div className="mt-auto pt-4">
                    <div className="holo-rule mb-2.5" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2 text-[0.625rem] font-semibold uppercase tracking-[0.16em]">
                      <span className="truncate text-white/55">{card.rank}</span>
                      <span className="shrink-0 text-white/70 transition-colors group-hover:text-white">
                        Take command <span aria-hidden="true" className="inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
                      </span>
                    </div>
                  </div>
                </div>
                <span className="holo-shine" aria-hidden="true" />
              </button>
            </FadeIn>
          );
        })}
      </div>

      <FadeIn delay={0.3} className="relative mt-7 flex flex-col items-center gap-3 pointer-events-auto">
        <GlassButton hotkey="Esc" onClick={goMenu}>
          Back
        </GlassButton>
        <KeyHint keys={['1', '–', '4']}>pick a card · Enter to confirm</KeyHint>
      </FadeIn>
    </div>
  );
}
