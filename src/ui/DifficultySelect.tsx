import { DIFFICULTY_INFO } from '../game/ai';
import type { Difficulty } from '../game/ai';
import { COMMANDERS, GRID_SIZE } from '../game/types';
import { useGame } from '../state/store';
import { CommanderAvatar, RankChevrons } from './CommanderAvatar';
import { FadeIn, GlassButton, Kbd, KeyHint, ScreenHeader } from './Glass';
import { useHotkeys } from './hotkeys';

const ORDER: Difficulty[] = ['cadet', 'officer', 'commander', 'admiral'];
const THREAT_COLOR = ['#5eead4', '#9aa7ff', '#fbbf24', '#fb7185'];
const THREAT = ['Low', 'Elevated', 'High', 'Boss'];
const ROMAN = ['I', 'II', 'III', 'IV'];
const CELLS = GRID_SIZE * GRID_SIZE;
/** fewest possible shots to sink a full fleet */
const MIN_SHOTS = 17;

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
      <FadeIn className="relative mb-6">
        <ScreenHeader eyebrow="Step 2 of 3 · Mission profile" title="Choose Your Build Failure" size="md" />
        <div className="mt-4 flex justify-center">
          <span className="chip bg-black/30 !py-1 !pl-1 text-white/80">
            <CommanderAvatar id={commander.id} size="sm" />
            <span>
              Commanding: <strong className="text-white">{commander.name}</strong>
            </span>
          </span>
        </div>
      </FadeIn>
      <div className="relative grid w-full max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 pointer-events-auto">
        {ORDER.map((d, i) => {
          const info = DIFFICULTY_INFO[d];
          const rec = records[d];
          const color = THREAT_COLOR[i];
          const boss = d === 'admiral';
          // lethality: 0 = needs the whole board, 1 = perfect play (17 shots)
          const lethality = Math.max(0, Math.min(1, (CELLS - info.avgShots) / (CELLS - MIN_SHOTS)));
          return (
            <FadeIn key={d} delay={0.06 * i + 0.08}>
              <button
                type="button"
                aria-keyshortcuts={String(i + 1)}
                aria-label={`${info.label}, rank ${info.rank} of 4. ${info.doctrine} Wins in about ${info.avgShots} shots on average.`}
                className="glass glass-opaque glass-interactive group relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-5 text-left"
                style={boss ? { borderColor: 'rgba(251,113,133,0.4)', boxShadow: '0 0 50px rgba(251,113,133,0.12), 0 18px 50px rgba(0,0,0,0.42)' } : undefined}
                onClick={() => startDeploy(d)}
              >
                <div
                  className="pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full opacity-20 blur-3xl transition-opacity duration-500 group-hover:opacity-45"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <div className="mb-3 flex w-full items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                      style={{ borderColor: `${color}55`, background: `${color}14` }}
                    >
                      <RankChevrons count={info.rank} color={color} className="w-5" />
                    </span>
                    <div className="leading-tight">
                      <div className="label-caps !text-[0.625rem]" style={{ color }}>
                        Rank {ROMAN[info.rank - 1]} · {THREAT[i]}
                      </div>
                      <div className="mt-0.5 flex gap-0.5" aria-hidden="true">
                        {ORDER.map((_, b) => (
                          <span key={b} className="h-1 w-4 rounded-full" style={{ background: b <= i ? color : 'rgba(255,255,255,0.12)' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <Kbd>{i + 1}</Kbd>
                </div>
                <span className="text-xl font-bold leading-tight tracking-tight text-white">{info.label}</span>
                <span className="mt-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em]" style={{ color }}>
                  {info.tagline}
                </span>
                <p className="mt-2 text-[0.8rem] leading-snug text-white/60 italic">{info.description}</p>

                <div className="mt-3 rounded-xl border border-white/8 bg-black/25 p-3">
                  <div className="label-caps mb-1 !text-[0.575rem] !tracking-[0.18em]">Doctrine</div>
                  <p className="text-[0.8rem] leading-snug text-white/85">{info.doctrine}</p>
                </div>

                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="label-caps !text-[0.575rem] !tracking-[0.18em]">Avg shots to win</span>
                    <span className="num text-lg font-bold leading-none text-white">
                      {info.avgShots}
                      <span className="text-xs font-semibold text-white/45"> / {CELLS}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${8 + lethality * 92}%`, background: `linear-gradient(90deg, ${color}66, ${color})`, boxShadow: `0 0 10px ${color}88` }} />
                  </div>
                  <div className="mt-1 text-[0.625rem] text-white/45">Measured vs random fleets · lower is deadlier</div>
                </div>

                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-white/60">
                  <span className="num">{rec && rec.wins + rec.losses > 0 ? `Your record ${rec.wins}–${rec.losses}` : 'No record yet'}</span>
                  <span className="font-semibold uppercase tracking-[0.16em] transition-colors group-hover:text-white">Deploy →</span>
                </div>
              </button>
            </FadeIn>
          );
        })}
      </div>
      <FadeIn delay={0.34} className="relative mt-6 flex flex-col items-center gap-3 pointer-events-auto">
        <GlassButton hotkey="Esc" onClick={goCommander}>
          Back to commanders
        </GlassButton>
        <KeyHint keys={['1', '–', '4']}>pick a mission</KeyHint>
      </FadeIn>
    </div>
  );
}
