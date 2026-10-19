export const GRID_SIZE = 10;

export interface Coord {
  x: number;
  y: number;
}

export type Orientation = 'h' | 'v';

export interface ShipSpec {
  id: string;
  name: string;
  length: number;
}

export const FLEET: ShipSpec[] = [
  { id: 'carrier', name: 'Carrier', length: 5 },
  { id: 'battleship', name: 'Battleship', length: 4 },
  { id: 'cruiser', name: 'Cruiser', length: 3 },
  { id: 'submarine', name: 'Submarine', length: 3 },
  { id: 'destroyer', name: 'Destroyer', length: 2 },
];

export const shipSpec = (id: string): ShipSpec => {
  const spec = FLEET.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown ship id: ${id}`);
  return spec;
};

export interface PlacedShip {
  spec: ShipSpec;
  cells: Coord[];
  hits: number;
  sunk: boolean;
}

export type CellMark = 'unknown' | 'miss' | 'hit';

export type ShotOutcome =
  | { kind: 'miss' }
  | { kind: 'hit'; shipId: string }
  | { kind: 'sunk'; shipId: string }
  | { kind: 'already' }
  | { kind: 'win'; shipId: string };

export const inBounds = (c: Coord): boolean =>
  c.x >= 0 && c.x < GRID_SIZE && c.y >= 0 && c.y < GRID_SIZE;

export const coordEq = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y;

export const coordKey = (c: Coord): number => c.y * GRID_SIZE + c.x;

export const keyToCoord = (k: number): Coord => ({ x: k % GRID_SIZE, y: Math.floor(k / GRID_SIZE) });

export const ORTHOGONAL: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export type Rng = () => number;
