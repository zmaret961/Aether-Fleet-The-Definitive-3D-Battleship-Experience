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

// Battle layout: own fleet sits toward the camera, enemy waters behind —
// the Battleship "laptop" opened on the table.
export const PLAYER_BOARD_POS: [number, number, number] = [0, 0, 5.7];
export const ENEMY_BOARD_POS: [number, number, number] = [0, 0, -5.7];

export const PALETTE = {
  deepSea: '#04101e',
  seaMid: '#0a2238',
  accent: '#67e8f9',
  accentSoft: '#22d3ee',
  hit: '#f59e0b',
  hitHot: '#fbbf24',
  miss: '#dbeafe',
  hull: '#556e85',
  hullDark: '#2c3c4e',
  enemy: '#fb7185',
} as const;
