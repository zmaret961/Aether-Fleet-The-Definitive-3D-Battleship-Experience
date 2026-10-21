import type { CommanderId } from '../game/types';

/** Per-commander avatar gradients (cosmetic only). */
export const COMMANDER_HUES: Record<CommanderId, { from: string; to: string; glow: string }> = {
  'scott-wu': { from: '#c3ccff', to: '#5146ff', glow: 'rgba(81,70,255,0.45)' },
  'chris-degnan': { from: '#a7f3d0', to: '#0d9488', glow: 'rgba(13,148,136,0.45)' },
  'jeff-wang': { from: '#bae6fd', to: '#0284c7', glow: 'rgba(2,132,199,0.45)' },
  'will-mccarthy': { from: '#fde68a', to: '#d97706', glow: 'rgba(217,119,6,0.4)' },
};

export const colLetter = (x: number) => String.fromCharCode(65 + x);
export const cellName = (c: { x: number; y: number }) => `${colLetter(c.x)}${c.y + 1}`;
