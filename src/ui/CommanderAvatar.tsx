import { useId } from 'react';
import type { CommanderId } from '../game/types';
import { COMMANDERS } from '../game/types';
import { COMMANDER_HUES } from './theme';

const SIZES = {
  sm: 'h-8 w-8',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
  xl: 'h-32 w-32',
};

const SHIELD = 'M32 2.5 L58 11.5 V31 C58 46 47 56.5 32 61.5 C17 56.5 6 46 6 31 V11.5 Z';
const INNER = 'M32 8.5 L52 15.5 V31 C52 42.5 44 50.5 32 55 C20 50.5 12 42.5 12 31 V15.5 Z';

/** Commander insignia glyphs, drawn on a 64×64 shield. */
function Glyph({ id, ink }: { id: CommanderId; ink: string }) {
  const stroke = { fill: 'none', stroke: ink, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'scott-wu':
      // Grandmaster: a five-point star held in code brackets, over a laurel.
      return (
        <g>
          <path d="M32 19.5 L34.9 26.6 L42.5 27.1 L36.6 32 L38.5 39.4 L32 35.3 L25.5 39.4 L27.4 32 L21.5 27.1 L29.1 26.6 Z" fill={ink} />
          <path d="M20.5 22.5 L15.8 30 L20.5 37.5" {...stroke} />
          <path d="M43.5 22.5 L48.2 30 L43.5 37.5" {...stroke} />
          <path d="M21 44 Q32 50.5 43 44" {...stroke} strokeWidth={2} />
          <path d="M24 46.2 l-1.6 -2.6 M28 47.8 l-1 -2.9 M36 47.8 l1 -2.9 M40 46.2 l1.6 -2.6" {...stroke} strokeWidth={1.6} />
        </g>
      );
    case 'chris-degnan':
      // Closer: a pipeline chart that only goes up and to the right.
      return (
        <g>
          <rect x="18" y="36" width="6" height="9" rx="1.2" fill={ink} opacity="0.7" />
          <rect x="27" y="30" width="6" height="15" rx="1.2" fill={ink} opacity="0.85" />
          <rect x="36" y="24" width="6" height="21" rx="1.2" fill={ink} />
          <path d="M16.5 30 L26 21.5 L31 25.5 L44.5 14.5" {...stroke} />
          <path d="M38.5 14 H45 V20.5" {...stroke} />
        </g>
      );
    case 'jeff-wang':
      // Windsurfer: a full sail over a rolling wake.
      return (
        <g>
          <path d="M31 12.5 C39.5 19 44.5 29 45 38.5 L31 38.5 Z" fill={ink} />
          <path d="M28.5 15 C24.5 23 22.5 31 23 38.5 L28.5 38.5 Z" fill={ink} opacity="0.6" />
          <path d="M19 42 H46" {...stroke} />
          <path d="M15.5 48 Q20 44.5 24.5 48 T33.5 48 T42.5 48 T49 47" {...stroke} strokeWidth={2.1} />
        </g>
      );
    case 'will-mccarthy':
      // Vanguard: compass rose with the needle pointed at new territory.
      return (
        <g>
          <circle cx="32" cy="31" r="14" {...stroke} strokeWidth={2.1} />
          <path d="M32 13.5 L37 31 L32 27.5 L27 31 Z" fill={ink} />
          <path d="M32 48.5 L37 31 L32 34.5 L27 31 Z" fill="none" stroke={ink} strokeWidth={1.6} strokeLinejoin="round" />
          <path d="M16 31 h4 M44 31 h4" {...stroke} strokeWidth={2} />
        </g>
      );
  }
}

/** Illustrated shield insignia. `badge` adds the gradient rim; plain renders on transparent. */
export function CommanderEmblem({ id, className = '' }: { id: CommanderId; className?: string }) {
  const hue = COMMANDER_HUES[id];
  const gid = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${gid}-rim`} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={hue.from} />
          <stop offset="1" stopColor={hue.to} />
        </linearGradient>
        <radialGradient id={`${gid}-field`} cx="0.5" cy="0.25" r="0.85">
          <stop offset="0" stopColor={hue.to} stopOpacity="0.55" />
          <stop offset="1" stopColor="#060a24" />
        </radialGradient>
      </defs>
      <path d={SHIELD} fill={`url(#${gid}-rim)`} />
      <path d={INNER} fill={`url(#${gid}-field)`} />
      <path d={INNER} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.8" />
      <Glyph id={id} ink={hue.from} />
    </svg>
  );
}

/** Rank chevrons (and an optional star) like a sleeve insignia. */
export function RankChevrons({ count, star = false, color, className = '' }: { count: number; star?: boolean; color: string; className?: string }) {
  const h = 9 + count * 7 + (star ? 12 : 0);
  return (
    <svg viewBox={`0 0 28 ${h}`} className={className} style={{ height: h * 0.9 }} aria-hidden="true">
      {star && <path d="M14 1 L16.2 6.3 L21.8 6.6 L17.5 10.2 L18.9 15.6 L14 12.6 L9.1 15.6 L10.5 10.2 L6.2 6.6 L11.8 6.3 Z" fill={color} />}
      {Array.from({ length: count }).map((_, i) => {
        const y = (star ? 14 : 2) + i * 7;
        return <path key={i} d={`M3 ${y} L14 ${y + 6} L25 ${y}`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
      })}
    </svg>
  );
}

export function CommanderAvatar({ id, size = 'md' }: { id: CommanderId; size?: keyof typeof SIZES }) {
  const c = COMMANDERS.find((entry) => entry.id === id) ?? COMMANDERS[0];
  const hue = COMMANDER_HUES[c.id];
  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center ${SIZES[size]}`} style={{ filter: `drop-shadow(0 4px 14px ${hue.glow})` }}>
      <CommanderEmblem id={c.id} className="h-full w-full" />
    </span>
  );
}
