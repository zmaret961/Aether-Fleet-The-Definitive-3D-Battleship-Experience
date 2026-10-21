import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../state/store';
import type { PerfMode, Settings } from '../state/store';
import { GlassButton, GlassPanel, Kbd } from './Glass';
import { isTypingTarget, keyOf } from './hotkeys';
import { SHORTCUT_GROUPS } from './shortcuts';
import { useUi } from './uiStore';
import { useFocusTrap } from './focusTrap';

function Row({ label, desc, children, htmlFor }: { label: string; desc?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3.5 last:border-0">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-semibold text-white">
          {label}
        </label>
        {desc && <div className="mt-0.5 text-xs text-white/60">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, id, label }: { on: boolean; onChange: (v: boolean) => void; id: string; label: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ${
        on ? 'border-accent/70 bg-accent-2/80' : 'border-white/15 bg-white/10'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5.5 w-5.5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-[left] duration-300 ease-[var(--ease-spring)] ${
          on ? 'left-[1.4rem]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function Modal({ open, onClose, labelledBy, children, width = 'max-w-md' }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; width?: string }) {
  const reduced = useGame((s) => s.settings.reducedMotion);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog, open);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020812]/60 p-4 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: reduced ? 1 : 0.94, y: reduced ? 0 : 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: reduced ? 1 : 0.96, y: reduced ? 0 : 10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            ref={dialog}
            className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[1.25rem] ${width}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const PERF: { value: PerfMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
];

function SettingsDialog() {
  const open = useGame((s) => s.settingsOpen);
  const setOpen = useGame((s) => s.setSettingsOpen);
  const settings = useGame((s) => s.settings);
  const update = useGame((s) => s.updateSettings);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const id = useId();

  const patch = (p: Partial<Settings>) => update(p);
  const volPct = Math.round(settings.volume * 100);

  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy={`${id}-title`}>
      <GlassPanel strong className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="label-caps text-accent">Bridge controls</div>
            <h3 id={`${id}-title`} className="title-display mt-1 text-3xl">
              Settings
            </h3>
          </div>
          <GlassButton className="!px-3 !py-1.5" hotkey="Esc" onClick={() => setOpen(false)} data-autofocus>
            Close
          </GlassButton>
        </div>
        <Row label="Master volume" htmlFor={`${id}-vol`} desc={settings.muted ? 'Muted' : `${volPct}%`}>
          <input
            id={`${id}-vol`}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            aria-valuetext={`${volPct}%`}
            onChange={(e) => patch({ volume: Number(e.target.value), muted: false })}
            className="w-40 cursor-pointer accent-[#9aa7ff]"
          />
        </Row>
        <Row label="Mute all audio" desc="Shortcut: M" htmlFor={`${id}-mute`}>
          <Toggle id={`${id}-mute`} label="Mute all audio" on={settings.muted} onChange={(v) => patch({ muted: v })} />
        </Row>
        <Row label="Reduced motion" desc="Calms water, disables heavy effects" htmlFor={`${id}-rm`}>
          <Toggle id={`${id}-rm`} label="Reduced motion" on={settings.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} />
        </Row>
        <Row label="High contrast" desc="Solid panels, brighter text and focus rings" htmlFor={`${id}-hc`}>
          <Toggle id={`${id}-hc`} label="High contrast" on={settings.highContrast} onChange={(v) => patch({ highContrast: v })} />
        </Row>
        <Row label="Performance" desc="Auto scales detail to hold 60fps">
          <div role="radiogroup" aria-label="Performance mode" className="flex rounded-xl border border-white/12 bg-white/[0.04] p-0.5">
            {PERF.map((p) => {
              const active = settings.perfMode === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => patch({ perfMode: p.value })}
                  className={`cursor-pointer rounded-[0.6rem] px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? 'bg-accent/90 text-[#0d1036] shadow-[0_2px_10px_rgba(81,70,255,0.4)]' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </Row>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setShortcutsOpen(true);
          }}
          className="mt-4 flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/80 transition-colors hover:border-accent/40 hover:text-white"
        >
          <span>Keyboard shortcuts</span>
          <Kbd>?</Kbd>
        </button>
      </GlassPanel>
    </Modal>
  );
}

function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  const id = useId();
  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy={`${id}-title`} width="max-w-3xl">
      <GlassPanel strong className="p-6 sm:p-7">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="label-caps text-accent">Field manual</div>
            <h3 id={`${id}-title`} className="title-display mt-1 text-3xl">
              Keyboard shortcuts
            </h3>
          </div>
          <GlassButton className="!px-3 !py-1.5" hotkey="Esc" onClick={() => setOpen(false)} data-autofocus>
            Close
          </GlassButton>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h4 className="label-caps mb-2">{g.title}</h4>
              <ul className="space-y-1.5">
                {g.items.map((item) => (
                  <li key={item.label + item.keys.join()} className="flex items-center justify-between gap-3 text-sm text-white/80">
                    <span>{item.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (k === '–' ? <span key={k} className="text-white/40">–</span> : <Kbd key={k}>{k}</Kbd>))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </GlassPanel>
    </Modal>
  );
}

/** Global keys that work on every screen: ? shortcuts, S settings, M mute, Esc closes sheets. */
function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      const key = keyOf(e);
      const ui = useUi.getState();
      const game = useGame.getState();
      if (key === 'Escape' && ui.shortcutsOpen) {
        e.preventDefault();
        ui.setShortcutsOpen(false);
        return;
      }
      if (key === '?') {
        e.preventDefault();
        game.setSettingsOpen(false);
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }
      if (ui.shortcutsOpen) return;
      if (key === 's') {
        e.preventDefault();
        game.setSettingsOpen(!game.settingsOpen);
      } else if (key === 'm') {
        e.preventDefault();
        game.updateSettings({ muted: !game.settings.muted });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function SettingsPanel() {
  useGlobalKeys();
  return (
    <>
      <SettingsDialog />
      <ShortcutsDialog />
    </>
  );
}
