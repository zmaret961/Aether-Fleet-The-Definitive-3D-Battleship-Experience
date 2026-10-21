import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DIFFICULTY_INFO } from '../game/ai';
import { storyToText } from '../game/story';
import type { MatchStory } from '../game/story';
import { COMMANDERS } from '../game/types';
import { formatClock, useGame } from '../state/store';
import { GlassButton, GlassPanel } from './Glass';
import { canvasToBlob, renderShareCard } from './shareCard';
import type { ShareCardInput } from './shareCard';
import { COMMANDER_HUES } from './theme';

const TONE: Record<string, string> = {
  win: 'bg-accent shadow-[0_0_10px_var(--color-accent)]',
  loss: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.7)]',
  neutral: 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.6)]',
};

export function MatchStoryPanel({ story }: { story: MatchStory }) {
  const [sharing, setSharing] = useState(false);
  return (
    <div className="glass rounded-2xl p-4 text-left">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="label-caps text-accent">Session timeline</span>
        <div className="flex items-center gap-3">
          <span className="label-caps !text-[0.55rem] max-sm:hidden">
            Legacy accuracy {story.ai.pct}% · {story.ai.hits}/{story.ai.shots}
          </span>
          <button
            type="button"
            onClick={() => setSharing(true)}
            className="glass-interactive btn-ghost inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.7rem] font-semibold tracking-wide"
          >
            <ShareIcon />
            Share field report
          </button>
        </div>
      </div>
      <ol className="gap-x-6 sm:columns-2">
        {story.beats.map((beat, i) => (
          <li key={`${beat.title}-${i}`} className="relative break-inside-avoid border-l border-white/10 pb-2 pl-4">
            <span className={`absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ${TONE[beat.tone]}`} />
            <div className="flex items-baseline gap-2">
              <span className="text-[0.8rem] font-semibold text-white">{beat.title}</span>
              <span className="label-caps !text-[0.5rem]">T{beat.turn}</span>
            </div>
            <div className="text-xs leading-snug text-white/55">{beat.detail}</div>
          </li>
        ))}
      </ol>
      <div className="mt-2 rounded-lg border border-emerald-400/20 bg-black/40 px-3 py-2 font-mono text-[0.65rem] leading-relaxed text-emerald-300/90">
        <span className="text-emerald-500/70">LEGACY-MONOLITH&gt; </span>
        {story.monolithQuote}
      </div>
      <AnimatePresence>{sharing && <SharePanel story={story} onClose={() => setSharing(false)} />}</AnimatePresence>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 10V2m0 0L5 5m3-3 3 3M3 9v4h10V9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // insecure context / permissions: legacy fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
};

function useShareData(story: MatchStory) {
  const stats = useGame((s) => s.stats);
  const match = useGame((s) => s.match);
  const difficulty = useGame((s) => s.difficulty);
  const commanderId = useGame((s) => s.commanderId);
  const commander = COMMANDERS.find((c) => c.id === commanderId) ?? COMMANDERS[0];
  const hue = COMMANDER_HUES[commander.id];
  const duration = formatClock(stats?.durationSec ?? 0);
  const marks = match?.enemy.marks ?? [];
  const sunkCells = new Set(
    (match?.enemy.ships ?? []).filter((s) => s.sunk).flatMap((s) => s.cells.map((c) => `${c.x},${c.y}`)),
  );
  const base = {
    shots: stats?.shots ?? 0,
    accuracyPct: stats?.accuracyPct ?? 0,
    shipsSunk: stats?.shipsSunk ?? 0,
    duration,
    difficultyLabel: DIFFICULTY_INFO[difficulty].label,
  };
  const card: ShareCardInput = {
    ...base,
    story,
    won: stats?.winner === 'player',
    commander: { name: commander.name, initials: commander.initials, from: hue.from, to: hue.to },
    marks,
    sunkCells,
  };
  const text = storyToText(story, { ...base, commanderName: commander.name, marks });
  const fileName = `aether-fleet-field-report-${difficulty}-${(stats?.winner ?? 'player') === 'player' ? 'shipped' : 'rolled-back'}.png`;
  return { card, text, fileName };
}

function SharePanel({ story, onClose }: { story: MatchStory; onClose: () => void }) {
  const { card, text, fileName } = useShareData(story);
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    renderShareCard(card)
      .then(canvasToBlob)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setPng({ url, blob });
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // render once per opened panel; the finished match can't change underneath it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // modal: keep the result screen's Enter (rematch) / Esc (menu) hotkeys out
    const onKey = (e: KeyboardEvent) => {
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (!onButton || e.key !== 'Enter') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const file = png ? new File([png.blob], fileName, { type: 'image/png' }) : null;
  const canNativeShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  const download = () => {
    if (!png) return;
    const a = document.createElement('a');
    a.href = png.url;
    a.download = fileName;
    a.click();
    setToast('PNG card saved');
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#020812]/70 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Share field report"
    >
      <motion.div initial={{ y: 14, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, scale: 0.98 }} className="w-full max-w-2xl">
        <GlassPanel strong className="glass-opaque p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="label-caps text-accent">Share field report</span>
            <button type="button" onClick={onClose} className="text-xs text-white/55 hover:text-white" aria-label="Close share panel">
              Close · Esc
            </button>
          </div>
          <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
            {png ? (
              <img src={png.url} alt={`Field report card: ${story.headline}`} className="h-full w-full" draggable={false} />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-white/50">
                {error ? 'Card rendering is unavailable in this browser. Copy the text instead.' : 'Rendering card…'}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
            <span className="mr-auto text-xs text-white/60" role="status" aria-live="polite">
              {toast ?? 'Paste into Slack, a PR, or your next QBR deck.'}
            </span>
            <GlassButton onClick={async () => setToast((await copyText(text)) ? 'Report copied as text' : 'Copy failed')}>Copy as text</GlassButton>
            {canNativeShare && file && (
              <GlassButton onClick={() => navigator.share({ files: [file], title: 'Aether Fleet field report', text: `${story.headline} ${story.subhead}` }).catch(() => {})}>
                Share…
              </GlassButton>
            )}
            <GlassButton variant="primary" onClick={download} disabled={!png}>
              Download PNG
            </GlassButton>
          </div>
        </GlassPanel>
      </motion.div>
    </motion.div>
  );
}
