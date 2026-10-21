import { GRID_SIZE } from '../game/types';
import type { Coord } from '../game/types';

export const CELL = 1;
export const BOARD_HALF = (GRID_SIZE * CELL) / 2;

export const cellToWorld = (c: Coord): [number, number] => [
  c.x * CELL - BOARD_HALF + CELL / 2,
  c.y * CELL - BOARD_HALF + CELL / 2,
];

export const worldToCell = (wx: number, wz: number): Coord | null => {
  const x = Math.floor((wx + BOARD_HALF) / CELL);
  const y = Math.floor((wz + BOARD_HALF) / CELL);
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
  return { x, y };
};

// Battle layout: the Battleship "laptop" opened on the table. Enemy waters are
// the hero target (full size, centre frame); your own fleet sits in front at a
// reduced scale so it stays readable without stealing the shot.
export const ENEMY_BOARD_POS: [number, number, number] = [0, 0, -3.4];
export const PLAYER_BOARD_SCALE = 0.6;
export const PLAYER_BOARD_POS: [number, number, number] = [0, 0, ENEMY_BOARD_POS[2] + BOARD_HALF + 1.25 + BOARD_HALF * PLAYER_BOARD_SCALE];
export const ENEMY_BOARD_SCALE = 1;
export const LEGACY_MONOLITH_POSITION: [number, number, number] = [0, 1.3, ENEMY_BOARD_POS[2] - BOARD_HALF - 3.1];
export const LEGACY_MONOLITH_SCALE: [number, number, number] = [1.7, 1.35, 1.6];

export const boardScale = (side: 'player' | 'enemy') => (side === 'player' ? PLAYER_BOARD_SCALE : ENEMY_BOARD_SCALE);

export const PALETTE = {
  deepSea: '#04101e',
  seaMid: '#0c2c44',
  accent: '#67e8f9',
  accentSoft: '#22d3ee',
  hit: '#f59e0b',
  hitHot: '#fbbf24',
  miss: '#dbeafe',
  hull: '#8199ae',
  hullDark: '#34475a',
  enemy: '#fb7185',
} as const;
