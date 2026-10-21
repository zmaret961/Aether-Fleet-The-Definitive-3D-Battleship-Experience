import type { CommanderId } from '../game/types';

/** Per-commander avatar gradients (cosmetic only). */
export const COMMANDER_HUES: Record<CommanderId, { from: string; to: string; glow: string }> = {
  'scott-wu': { from: '#c3ccff', to: '#5146ff', glow: 'rgba(81,70,255,0.45)' },
  'chris-degnan': { from: '#a7f3d0', to: '#0d9488', glow: 'rgba(13,148,136,0.45)' },
  'jeff-wang': { from: '#bae6fd', to: '#0284c7', glow: 'rgba(2,132,199,0.45)' },
  'will-mccarthy': { from: '#fde68a', to: '#d97706', glow: 'rgba(217,119,6,0.4)' },
};

/** Collectible-card flavour for each commander. Cosmetic only: no gameplay effect. */
export const COMMANDER_CARDS: Record<
  CommanderId,
  { callSign: string; rank: string; chevrons: number; star: boolean; signature: string; serial: string }
> = {
  'scott-wu': {
    callSign: 'Grandmaster',
    rank: 'Fleet Admiral',
    chevrons: 3,
    star: true,
    signature: 'Solves the board before the first shot lands.',
    serial: '01',
  },
  'chris-degnan': {
    callSign: 'Closer',
    rank: 'Admiral',
    chevrons: 3,
    star: false,
    signature: 'Always be closing: deals, tickets, enemy fleets.',
    serial: '02',
  },
  'jeff-wang': {
    callSign: 'Windsurfer',
    rank: 'Admiral',
    chevrons: 3,
    star: false,
    signature: 'Rides the wake straight into enemy waters.',
    serial: '03',
  },
  'will-mccarthy': {
    callSign: 'Vanguard',
    rank: 'Commodore',
    chevrons: 3,
    star: false,
    signature: 'First into every new account, first into the fight.',
    serial: '04',
  },
};

export const colLetter = (x: number) => String.fromCharCode(65 + x);
export const cellName = (c: { x: number; y: number }) => `${colLetter(c.x)}${c.y + 1}`;
