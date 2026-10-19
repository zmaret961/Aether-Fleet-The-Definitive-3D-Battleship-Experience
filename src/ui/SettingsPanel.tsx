import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../state/store';
import type { PerfMode, Settings } from '../state/store';
import { GlassButton, GlassPanel } from './Glass';

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/5 last:border-0">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        {desc && <div className="text-xs text-white/45 mt-0.5">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-12 h-6.5 rounded-full relative cursor-pointer transition-colors ${
        on ? 'bg-cyan-400/60' : 'bg-white/15'
      }`}
      aria-pressed={on}
    >
      <div
        className={`absolute top-0.75 w-5 h-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-6.5' : 'left-0.75'
        }`}
      />
    </button>
  );
}

export function SettingsPanel() {
  const open = useGame((s) => s.settingsOpen);
  const setOpen = useGame((s) => s.setSettingsOpen);
  const settings = useGame((s) => s.settings);
  const update = useGame((s) => s.updateSettings);

  const patch = (p: Partial<Settings>) => update(p);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.94, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <GlassPanel strong className="p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="title-display text-2xl">Settings</h3>
                <GlassButton className="!px-3 !py-1.5" onClick={() => setOpen(false)}>
                  Close
                </GlassButton>
              </div>
              <Row label="Master volume">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.volume}
                  onChange={(e) => patch({ volume: Number(e.target.value), muted: false })}
                  className="w-32 accent-cyan-300"
                />
              </Row>
              <Row label="Mute all audio">
                <Toggle on={settings.muted} onChange={(v) => patch({ muted: v })} />
              </Row>
              <Row label="Reduced motion" desc="Calms water, disables heavy effects">
                <Toggle on={settings.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} />
              </Row>
              <Row label="High contrast" desc="Stronger panels and accents">
                <Toggle on={settings.highContrast} onChange={(v) => patch({ highContrast: v })} />
              </Row>
              <Row label="Performance mode" desc="Auto scales detail to hold 60fps">
                <select
                  value={settings.perfMode}
                  onChange={(e) => patch({ perfMode: e.target.value as PerfMode })}
                  className="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="auto">Auto</option>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </Row>
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
