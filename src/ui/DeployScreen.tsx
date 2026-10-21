import { DIFFICULTY_INFO } from '../game/ai';
import { FLEET } from '../game/types';
import type { ShipSpec } from '../game/types';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel, Kbd, KeyHint } from './Glass';
import { useHotkeys } from './hotkeys';

export function DeployScreen() {
  const deploy = useGame((s) => s.deploy);
  const difficulty = useGame((s) => s.difficulty);
  const selectShip = useGame((s) => s.selectShip);
  const pickupShip = useGame((s) => s.pickupShip);
  const rotateDeploy = useGame((s) => s.rotateDeploy);
  const autoPlace = useGame((s) => s.autoPlace);
  const resetDeploy = useGame((s) => s.resetDeploy);
  const beginBattle = useGame((s) => s.beginBattle);
  const goMenu = useGame((s) => s.goMenu);

  const placed = new Set(deploy.board.ships.map((s) => s.spec.id));
  const allPlaced = placed.size === FLEET.length;
  const selectedSpec = FLEET.find((f) => f.id === deploy.selected);

  const choose = (spec: ShipSpec) => (placed.has(spec.id) ? pickupShip(spec.id) : selectShip(spec.id));

  useHotkeys({
    ...Object.fromEntries(FLEET.map((spec, i) => [String(i + 1), () => choose(spec)])),
    a: autoPlace,
    x: resetDeploy,
    Enter: () => allPlaced && beginBattle(),
    Escape: () => {
      if (deploy.selected) useGame.setState((s) => ({ deploy: { ...s.deploy, selected: null } }));
      else goMenu();
    },
  });

  const instruction = selectedSpec
    ? `Tap the water to position ${selectedSpec.name}. Tap a placed ship to pick it back up.`
    : allPlaced
      ? 'Formation locked. Review your fleet, then begin the battle.'
      : 'Select a vessel from the tray, or Auto-Deploy a ready formation.';

  const tray = (vertical: boolean) => (
    <div
      role="listbox"
      aria-label="Fleet tray"
      className={vertical ? 'flex flex-col gap-2' : 'flex gap-2 overflow-x-auto pb-1 sm:gap-2.5'}
    >
      {FLEET.map((spec, i) => {
        const isPlaced = placed.has(spec.id);
        const isSelected = deploy.selected === spec.id;
        return (
          <button
            key={spec.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-keyshortcuts={String(i + 1)}
            aria-label={`${spec.name}, length ${spec.length}, ${isPlaced ? 'in position' : 'awaiting placement'}`}
            onClick={() => choose(spec)}
            className={`glass-interactive flex shrink-0 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
              vertical ? 'w-full' : 'min-w-36'
            } ${
              isSelected
                ? 'border-accent bg-accent/15 shadow-[0_0_28px_rgba(154,167,255,0.25)]'
                : isPlaced
                  ? 'border-success/25 bg-success/[0.06]'
                  : 'border-white/10 bg-white/[0.04]'
            }`}
          >
            <Kbd>{i + 1}</Kbd>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-white">{spec.name}</span>
                <span className="num text-[0.7rem] text-white/50">{spec.length}</span>
              </div>
              <div className="mt-1.5 flex gap-1">
                {Array.from({ length: spec.length }).map((_, j) => (
                  <span key={j} className={`pip ${isPlaced ? 'pip-ok' : isSelected ? 'pip-accent' : ''}`} />
                ))}
              </div>
            </div>
            <span
              className={`hidden text-[0.625rem] font-semibold uppercase tracking-[0.14em] sm:inline ${
                isSelected ? 'text-accent' : isPlaced ? 'text-success' : 'text-white/45'
              }`}
            >
              {isSelected ? 'Placing' : isPlaced ? 'Ready' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );

  const progress = (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label-caps">Deployed</span>
          <span className="num text-sm font-bold text-white">
            {placed.size}
            <span className="text-white/45">/{FLEET.length}</span>
          </span>
        </div>
        <div className="flex gap-1">
          {FLEET.map((f) => (
            <span key={f.id} className={`pip !h-1 ${placed.has(f.id) ? 'pip-ok' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );

  const rotateBtn = (
    <GlassButton onClick={rotateDeploy} hotkey="R" className="col-span-2 !justify-between" aria-label={`Rotate, currently ${deploy.orientation === 'h' ? 'horizontal' : 'vertical'}`}>
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-4 rounded-full bg-accent transition-transform duration-300 ${deploy.orientation === 'v' ? 'rotate-90' : ''}`}
        />
        <span className="text-white/60">Rotate ·</span> {deploy.orientation === 'h' ? 'Horizontal' : 'Vertical'}
      </span>
    </GlassButton>
  );

  const beginBtn = (
    <GlassButton
      variant="primary"
      onClick={beginBattle}
      disabled={!allPlaced}
      hotkey={allPlaced ? 'Enter' : undefined}
      className="!px-7 !py-3.5 text-[0.95rem]"
    >
      {allPlaced ? 'Begin Battle' : `Place ${FLEET.length - placed.size} more`}
    </GlassButton>
  );

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-between p-4 sm:p-6">
      {/* header */}
      <FadeIn from="above" className="flex items-start justify-between gap-4">
        <div className="max-w-xl">
          <div className="label-caps mb-1.5 text-accent">Step 3 of 3 · Phase 01</div>
          <h2 className="title-display text-3xl sm:text-5xl">Fleet Deployment</h2>
          <p className="mt-2 text-sm text-white/70" aria-live="polite">
            {instruction}
          </p>
        </div>
        <GlassPanel className="glass-hud hidden px-4 py-3 text-right sm:block">
          <div className="label-caps">Opponent</div>
          <div className="text-sm font-semibold text-danger">{DIFFICULTY_INFO[difficulty].label}</div>
        </GlassPanel>
      </FadeIn>

      {/* desktop: left rail that keeps the board clear */}
      <FadeIn
        from="left"
        delay={0.08}
        className="pointer-events-auto absolute left-6 top-1/2 hidden w-72 -translate-y-1/2 lg:block xl:w-80"
      >
        <GlassPanel strong className="flex flex-col gap-4 p-4">
          {progress}
          <div className="divider" />
          {tray(true)}
          <div className="divider" />
          <div className="grid grid-cols-2 gap-2">
            {rotateBtn}
            <GlassButton onClick={autoPlace} hotkey="A" className="!justify-between">
              Auto
            </GlassButton>
            <GlassButton onClick={resetDeploy} hotkey="X" className="!justify-between">
              Reset
            </GlassButton>
            <GlassButton onClick={goMenu} hotkey="Esc" className="col-span-2 !justify-between">
              Retreat
            </GlassButton>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* desktop: launch dock */}
      <FadeIn
        delay={0.14}
        className="pointer-events-auto absolute bottom-6 right-6 hidden flex-col items-end gap-2 lg:flex"
      >
        {beginBtn}
        <KeyHint keys={['Esc']}>{deploy.selected ? 'cancel placement' : 'retreat to menu'}</KeyHint>
      </FadeIn>

      {/* compact: bottom tray */}
      <FadeIn delay={0.1} className="pointer-events-auto lg:hidden">
        <GlassPanel strong className="mx-auto w-full max-w-3xl space-y-3 p-3 sm:p-4">
          {progress}
          {tray(false)}
          <div className="flex flex-wrap gap-2">
            {rotateBtn}
            <GlassButton onClick={autoPlace}>Auto-Deploy</GlassButton>
            <GlassButton onClick={resetDeploy}>Reset</GlassButton>
            <GlassButton onClick={goMenu}>Retreat</GlassButton>
            <div className="flex-1" />
            {beginBtn}
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
