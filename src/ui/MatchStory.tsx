import type { MatchStory } from '../game/story';

const TONE: Record<string, string> = {
  win: 'bg-accent shadow-[0_0_10px_var(--color-accent)]',
  loss: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.7)]',
  neutral: 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.6)]',
};

export function MatchStoryPanel({ story }: { story: MatchStory }) {
  return (
    <div className="glass rounded-2xl p-4 text-left">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-caps text-accent">Session timeline</span>
        <span className="label-caps !text-[0.55rem]">
          Legacy accuracy {story.ai.pct}% · {story.ai.hits}/{story.ai.shots}
        </span>
      </div>
      <ol className="relative ml-1.5 border-l border-white/10">
        {story.beats.map((beat, i) => (
          <li key={`${beat.title}-${i}`} className="relative pb-2 pl-4 last:pb-0">
            <span className={`absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ${TONE[beat.tone]}`} />
            <div className="flex items-baseline gap-2">
              <span className="text-[0.8rem] font-semibold text-white">{beat.title}</span>
              <span className="label-caps !text-[0.5rem]">T{beat.turn}</span>
            </div>
            <div className="text-xs leading-snug text-white/55">{beat.detail}</div>
          </li>
        ))}
      </ol>
      <div className="mt-3 rounded-lg border border-emerald-400/20 bg-black/40 px-3 py-2 font-mono text-[0.65rem] leading-relaxed text-emerald-300/90">
        <span className="text-emerald-500/70">LEGACY-MONOLITH&gt; </span>
        {story.monolithQuote}
      </div>
    </div>
  );
}
