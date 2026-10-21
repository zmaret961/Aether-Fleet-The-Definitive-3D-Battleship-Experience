import { DIFFICULTY_INFO } from '../game/ai';
import type { Difficulty } from '../game/ai';
import { COMMANDERS } from '../game/types';
import { useGame } from '../state/store';
import { CommanderAvatar } from './CommanderAvatar';
import { FadeIn, GlassButton, Kbd, KeyHint, ScreenHeader } from './Glass';
import { useHotkeys } from './hotkeys';

const ORDER: Difficulty[] = ['cadet', 'officer', 'commander', 'admiral'];
const THREAT_COLOR = ['#5eead4', '#9aa7ff', '#fbbf24', '#fb7185'];

export function DifficultySelect() {
  const startDeploy = useGame((s) => s.startDeploy);
  const goCommander = useGame((s) => s.goCommander);
  const records = useGame((s) => s.records);
  const commanderId = useGame((s) => s.commanderId);
  const commander = COMMANDERS.find((c) => c.id === commanderId) ?? COMMANDERS[0];

  useHotkeys({
    '1': () => startDeploy('cadet'),
    '2': () => startDeploy('officer'),
    '3': () => startDeploy('commander'),
    '4': () => startDeploy('admiral'),
    Escape: goCommander,
  });

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center-safe overflow-y-auto p-4 sm:p-6 pointer-events-none">
      <div className="vignette absolute inset-0" aria-hidden="true" />
      <FadeIn className="relative mb-7">
        <ScreenHeader eyebrow="Step 2 of 3 · Mission profile" title="Choose Your Build Failure" size="md" />
        <div className="mt-4 flex justify-center">
          <span className="chip bg-black/30 text-white/80">
            <CommanderAvatar id={commander.id} size="sm" />
            <span>
              Commanding: <strong className="text-white">{commander.name}</strong>
            </span>
          </span>
        </div>
      </FadeIn>
      <div className="relative grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 pointer-events-auto">
        {ORDER.map((d, i) => {
          const info = DIFFICULTY_INFO[d];
          const rec = records[d];
          const color = THREAT_COLOR[i];
          const boss = d === 'admiral';
          return (
            <FadeIn key={d} delay={0.06 * i + 0.08}>
              <button
                type="button"
                aria-keyshortcuts={String(i + 1)}
                className="glass glass-opaque glass-interactive group flex h-full w-full cursor-pointer flex-col p-5 text-left"
                style={boss ? { borderColor: 'rgba(251,113,133,0.35)' } : undefined}
                onClick={() => startDeploy(d)}
              >
                <div className="mb-3 flex w-full items-center justify-between">
                  <div className="flex items-end gap-1" aria-label={`Threat level ${i + 1} of 4`}>
                    {ORDER.map((_, b) => (
                      <span
                        key={b}
                        className="w-1.5 rounded-sm"
                        style={{
                          height: `${8 + b * 4}px`,
                          background: b <= i ? color : 'rgba(255,255,255,0.12)',
                          boxShadow: b <= i ? `0 0 8px ${color}88` : undefined,
                        }}
                      />
                    ))}
                    <span className="label-caps ml-2 !text-[0.625rem]" style={{ color }}>
                      {['Low', 'Elevated', 'High', 'Boss'][i]}
                    </span>
                  </div>
                  <Kbd>{i + 1}</Kbd>
                </div>
                <span className="text-xl font-bold tracking-tight text-white">{info.label}</span>
                <span className="mt-0.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color }}>
                  {info.tagline}
                </span>
                <p className="mt-2.5 text-sm leading-relaxed text-white/70">{info.description}</p>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-white/60">
                  <span className="num">
                    {rec && rec.wins + rec.losses > 0 ? `Record ${rec.wins}–${rec.losses}` : 'No record yet'}
                  </span>
                  <span className="font-semibold uppercase tracking-[0.16em] transition-colors group-hover:text-white">
                    Deploy →
                  </span>
                </div>
              </button>
            </FadeIn>
          );
        })}
      </div>
      <FadeIn delay={0.34} className="relative mt-7 flex flex-col items-center gap-3 pointer-events-auto">
        <GlassButton hotkey="Esc" onClick={goCommander}>
          Back to commanders
        </GlassButton>
        <KeyHint keys={['1', '–', '4']}>pick a mission</KeyHint>
      </FadeIn>
    </div>
  );
}
