import { COMMANDERS } from '../game/types';
import { useGame } from '../state/store';
import { FadeIn, GlassButton, GlassPanel, Kbd } from './Glass';
import { useHotkeys } from './hotkeys';
import { useUi } from './uiStore';

export function MainMenu() {
  const goDifficulty = useGame((s) => s.goDifficulty);
  const goHowTo = useGame((s) => s.goHowTo);
  const setSettingsOpen = useGame((s) => s.setSettingsOpen);
  const records = useGame((s) => s.records);
  const commanderId = useGame((s) => s.commanderId);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);

  const totalWins = Object.values(records).reduce((n, r) => n + (r?.wins ?? 0), 0);
  const totalGames = Object.values(records).reduce((n, r) => n + (r?.wins ?? 0) + (r?.losses ?? 0), 0);
  const winRate = totalGames ? Math.round((totalWins / totalGames) * 100) : 0;
  const commander = COMMANDERS.find((c) => c.id === commanderId) ?? COMMANDERS[0];

  useHotkeys({ Enter: goDifficulty, h: goHowTo });

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 pointer-events-none">
      <div className="vignette absolute inset-0" aria-hidden="true" />
      <FadeIn className="relative mb-5 w-full max-w-3xl sm:mb-6">
        <GlassPanel className="menu-hero hud-corners overflow-hidden rounded-[2rem] px-5 pb-7 pt-6 text-center sm:px-14 sm:pb-9 sm:pt-7">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[36rem] max-w-[120%] -translate-x-1/2 rounded-full bg-accent-2/25 blur-3xl"
            aria-hidden="true"
          />
          <div className="hero-sweep" aria-hidden="true" />
          <div className="mb-4 flex items-center justify-between gap-3 font-mono text-[0.6rem] uppercase tracking-[0.22em] text-white/40 max-sm:hidden" aria-hidden="true">
            <span>AF-01 // Sortie briefing</span>
            <span className="text-success/80">● Prod green</span>
          </div>
          <div className="mb-4 flex justify-center sm:mb-5">
            <span className="chip max-w-full border-accent/30 bg-accent/10 text-accent">
              <span className="live-dot h-1.5 w-1.5 shrink-0" />
              <span className="whitespace-nowrap uppercase tracking-[0.12em] sm:tracking-[0.2em]">
                Cognition · <span className="sm:hidden">Exercise 01</span>
                <span className="max-sm:hidden">Field exercise 01</span>
              </span>
            </span>
          </div>
          <h1 className="title-display hero-title text-[3.4rem] sm:text-[6.5rem]">Aether Fleet</h1>
          <p className="mt-3 text-[0.95rem] text-white/75 sm:mt-4 sm:text-lg">
            A Cognition field exercise, <span className="font-semibold text-white">powered by Devin</span>
          </p>
          <div className="divider mx-auto my-4 w-48 sm:my-5 sm:w-64" />
          <p className="label-caps">Autonomous engineering, at sea</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-white/50 sm:mt-5" aria-label="Your fleet versus the Legacy Monolith">
            {['Devin', 'Windsurf', 'DeepWiki', 'Devin Review', 'Devin Oncall'].map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" aria-hidden="true" />
                {n}
              </span>
            ))}
            <span className="basis-full text-white/30 sm:hidden" aria-hidden="true" />
            <span className="inline-flex items-center gap-1.5 text-danger/90">
              <span className="text-white/35">vs</span>
              <span className="h-1 w-1 rounded-full bg-danger shadow-[0_0_6px_var(--color-danger)]" aria-hidden="true" />
              The Legacy Monolith
            </span>
          </div>
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.12} className="relative pointer-events-auto w-full max-w-sm">
        <GlassPanel strong className="flex flex-col gap-2.5 p-4">
          <GlassButton variant="primary" hotkey="Enter" onClick={goDifficulty} className="w-full !justify-between !py-3.5 text-[0.95rem]" autoFocus>
            Choose Your Commander
          </GlassButton>
          <div className="grid grid-cols-2 gap-2.5">
            <GlassButton hotkey="H" onClick={goHowTo} className="!justify-between">
              How to Play
            </GlassButton>
            <GlassButton hotkey="S" onClick={() => setSettingsOpen(true)} className="!justify-between">
              Settings
            </GlassButton>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
            <Stat label="Commander" value={commander.initials} />
            <Stat label="Record" value={totalGames ? `${totalWins}–${totalGames - totalWins}` : '—'} />
            <Stat label="Win rate" value={totalGames ? `${winRate}%` : '—'} />
          </div>
        </GlassPanel>
      </FadeIn>

      <div className="absolute bottom-5 flex w-full items-center justify-between px-6 text-xs text-white/55">
        <span className="chip pointer-events-auto bg-black/25">
          <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_10px_var(--color-success)]" />
          <span className="uppercase tracking-[0.16em]">FedRAMP High</span>
        </span>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-full px-2 py-1 hover:text-white"
        >
          <Kbd>?</Kbd> Keyboard shortcuts
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="num text-base font-bold text-white">{value}</div>
      <div className="label-caps mt-0.5 !text-[0.625rem] !tracking-[0.14em]">{label}</div>
    </div>
  );
}
