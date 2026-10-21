import type { CommanderId } from '../game/types';
import { COMMANDERS } from '../game/types';
import { COMMANDER_HUES } from './theme';

const SIZES = {
  sm: 'h-8 w-8 rounded-lg text-[0.7rem]',
  md: 'h-11 w-11 rounded-xl text-sm',
  lg: 'h-16 w-16 rounded-2xl text-xl',
};

export function CommanderAvatar({ id, size = 'md' }: { id: CommanderId; size?: keyof typeof SIZES }) {
  const c = COMMANDERS.find((entry) => entry.id === id) ?? COMMANDERS[0];
  const hue = COMMANDER_HUES[c.id];
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center font-extrabold tracking-tight text-[#0b1030] ${SIZES[size]}`}
      style={{
        background: `linear-gradient(145deg, ${hue.from}, ${hue.to})`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), 0 6px 22px ${hue.glow}`,
      }}
    >
      {c.initials}
    </span>
  );
}
