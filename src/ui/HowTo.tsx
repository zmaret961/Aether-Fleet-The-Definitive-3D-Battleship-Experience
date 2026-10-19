import { FadeIn, GlassButton, GlassPanel } from './Glass';
import { useGame } from '../state/store';

export function HowTo() {
  const goMenu = useGame((s) => s.goMenu);
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
      <FadeIn className="pointer-events-auto w-full max-w-lg">
        <GlassPanel strong className="p-6 sm:p-8">
          <div className="label-caps mb-2">Field Manual</div>
          <h2 className="title-display text-3xl mb-5">How to Play</h2>
          <ul className="space-y-3 text-sm text-white/70 leading-relaxed">
            <li>
              <span className="text-accent font-semibold">1 · Deploy.</span> Position your five ships —
              Devin (5), Windsurf (4), DeepWiki (3), Devin Review (3), Devin Oncall (2). Tap a ship
              in the tray, then tap the water to place it. Use Rotate or Auto-Deploy.
            </li>
            <li>
              <span className="text-accent font-semibold">2 · Engage.</span> Tap a cell on the enemy
              board to paint a firing solution, then tap FIRE to launch a missile. Tap a different cell to retarget.
            </li>
            <li>
              <span className="text-accent font-semibold">3 · Read the water.</span> Amber markers are
              hits; white rings are misses. Chain hits to find the rest of a ship — a sunk ship is
              announced and revealed.
            </li>
            <li>
              <span className="text-accent font-semibold">4 · Win.</span> Sink all five enemy vessels
              before Legacy closes your tickets. Both boards stay in view while the game plays out.
            </li>
          </ul>
          <div className="mt-6 flex justify-end">
            <GlassButton variant="primary" onClick={goMenu}>
              Understood
            </GlassButton>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
