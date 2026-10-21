import { FadeIn, GlassButton, GlassPanel, Kbd } from './Glass';
import { useGame } from '../state/store';
import { useHotkeys } from './hotkeys';
import { SHORTCUT_GROUPS } from './shortcuts';

const STEPS = [
  {
    n: '01',
    title: 'Deploy',
    body: 'Position your five ships — Devin (5), Windsurf (4), DeepWiki (3), Devin Review (3), Devin Oncall (2). Pick a ship from the tray, then tap the water. Rotate with R or Auto-Deploy with A.',
  },
  {
    n: '02',
    title: 'Engage',
    body: 'Tap a cell on the enemy board (the far grid) to paint a firing solution, then FIRE. Arrow keys nudge the reticle; Enter or Space launches.',
  },
  {
    n: '03',
    title: 'Read the water',
    body: 'Amber markers are hits; white rings are misses. Chain hits to find the rest of a ship — a sunk ship is announced and revealed.',
  },
  {
    n: '04',
    title: 'Ship it',
    body: 'Close all five enemy tickets before Legacy closes yours. Both boards stay in view while the game plays out.',
  },
];

export function HowTo() {
  const goMenu = useGame((s) => s.goMenu);
  useHotkeys({ Escape: goMenu, Enter: goMenu });
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4 pointer-events-none">
      <div className="vignette absolute inset-0" aria-hidden="true" />
      <FadeIn className="relative pointer-events-auto w-full max-w-4xl">
        <GlassPanel strong className="p-6 sm:p-9">
          <div className="label-caps mb-2 text-accent">Field manual</div>
          <h2 className="title-display mb-7 text-4xl sm:text-5xl">How to Play</h2>
          <div className="grid gap-8 md:grid-cols-[1.35fr_1fr]">
            <ol className="space-y-5">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="num mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-xs font-bold text-accent">
                    {s.n}
                  </span>
                  <div>
                    <div className="font-semibold text-white">{s.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-white/70">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="label-caps mb-3">Legend</div>
                <ul className="space-y-2.5 text-sm text-white/80">
                  <li className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-sm bg-ember shadow-[0_0_10px_var(--color-ember)]" /> Hit — PR merged
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full border-2 border-white/80" /> Miss — CI failed
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-sm bg-danger" /> Sunk — ticket closed
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" /> Firing solution
                  </li>
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="label-caps mb-3">Keyboard</div>
                <ul className="space-y-2 text-sm">
                  {SHORTCUT_GROUPS.flatMap((g) => g.items)
                    .filter((i) => i.howto)
                    .map((i) => (
                      <li key={i.label} className="flex items-center justify-between gap-3 text-white/75">
                        <span>{i.label}</span>
                        <span className="flex gap-1">
                          {i.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-8 flex items-center justify-between gap-3">
            <span className="text-xs text-white/55">
              Press <Kbd>?</Kbd> anytime for every shortcut.
            </span>
            <GlassButton variant="primary" hotkey="Enter" onClick={goMenu} autoFocus>
              Understood
            </GlassButton>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
