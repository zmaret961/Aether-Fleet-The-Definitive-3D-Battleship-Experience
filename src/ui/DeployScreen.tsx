import { FLEET } from '../game/types';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel } from './Glass';

export function DeployScreen() {
  const deploy = useGame((s) => s.deploy);
  const selectShip = useGame((s) => s.selectShip);
  const rotateDeploy = useGame((s) => s.rotateDeploy);
  const autoPlace = useGame((s) => s.autoPlace);
  const resetDeploy = useGame((s) => s.resetDeploy);
  const beginBattle = useGame((s) => s.beginBattle);
  const goMenu = useGame((s) => s.goMenu);

  const placed = new Set(deploy.board.ships.map((s) => s.spec.id));
  const allPlaced = placed.size === FLEET.length;

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-between p-4 sm:p-6">
      <FadeIn className="flex items-start justify-between">
        <div>
          <div className="label-caps">Phase 01</div>
          <h2 className="title-display text-2xl sm:text-4xl">Fleet Deployment</h2>
          <p className="text-white/55 text-xs sm:text-sm mt-1 max-w-xs">
            {deploy.selected
              ? 'Tap the water to position your ship. Tap a placed ship to pick it back up.'
              : 'Select a vessel from the tray, or Auto-Deploy a ready formation.'}
          </p>
        </div>
        <GlassPanel className="px-4 py-2 text-right">
          <div className="label-caps">Deployed</div>
          <div className="text-xl font-bold text-accent">
            {placed.size}<span className="text-white/40">/5</span>
          </div>
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.1} className="pointer-events-auto">
        <GlassPanel strong className="mx-auto w-full max-w-3xl p-3 sm:p-4">
          {/* ship tray */}
          <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-2">
            {FLEET.map((spec) => {
              const isPlaced = placed.has(spec.id);
              const isSelected = deploy.selected === spec.id;
              return (
                <button
                  key={spec.id}
                  disabled={isPlaced}
                  onClick={() => selectShip(spec.id)}
                  className={`glass-interactive shrink-0 rounded-xl px-3 py-2.5 text-left cursor-pointer min-w-24 border ${
                    isSelected
                      ? 'border-accent bg-cyan-400/10'
                      : isPlaced
                        ? 'border-emerald-400/30 bg-emerald-400/5 opacity-60'
                        : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="text-xs font-semibold whitespace-nowrap">{spec.name}</div>
                  <div className="flex gap-0.5 mt-1.5">
                    {Array.from({ length: spec.length }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 w-3 rounded-full ${isPlaced ? 'bg-emerald-400/70' : 'bg-accent/80'}`}
                      />
                    ))}
                  </div>
                  <div className="label-caps mt-1" style={{ fontSize: '0.55rem' }}>
                    {isPlaced ? 'In position' : 'Awaiting'}
                  </div>
                </button>
              );
            })}
          </div>
          {/* controls */}
          <div className="flex flex-wrap gap-2 pt-2">
            <GlassButton onClick={rotateDeploy} disabled={!deploy.selected}>
              Rotate {deploy.orientation === 'h' ? '→ Vertical' : '→ Horizontal'}
            </GlassButton>
            <GlassButton onClick={autoPlace}>Auto-Deploy</GlassButton>
            <GlassButton onClick={resetDeploy}>Reset</GlassButton>
            <GlassButton onClick={goMenu}>Retreat</GlassButton>
            <div className="flex-1" />
            <GlassButton variant="primary" onClick={beginBattle} disabled={!allPlaced}>
              {allPlaced ? 'Begin Battle' : `Place ${FLEET.length - placed.size} more`}
            </GlassButton>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
