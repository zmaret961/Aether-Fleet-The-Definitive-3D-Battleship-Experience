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

export interface CommanderProfile {
  id: string;
  name: string;
  role: string;
  tagline: string;
  initials: string;
}

export const COMMANDERS = [
  {
    id: 'scott-wu',
    name: 'Scott Wu',
    role: 'CEO',
    tagline: 'Competitive-programming champion. Calculates every shot.',
    initials: 'SW',
  },
  {
    id: 'chris-degnan',
    name: 'Chris Degnan',
    role: 'CRO',
    tagline: 'Closes every deal — and every ticket.',
    initials: 'CD',
  },
  {
    id: 'jeff-wang',
    name: 'Jeff Wang',
    role: 'President, New Enterprise · ex-Windsurf CEO',
    tagline: 'Rides the Windsurf wave into enemy waters.',
    initials: 'JW',
  },
  {
    id: 'will-mccarthy',
    name: 'Will McCarthy',
    role: 'Emerging Enterprise Leader',
    tagline: 'Leads the charge on every new account.',
    initials: 'WM',
  },
] as const satisfies readonly CommanderProfile[];

export type CommanderId = (typeof COMMANDERS)[number]['id'];

export const FLEET: ShipSpec[] = [
  { id: 'carrier', name: 'Devin', length: 5 },
  { id: 'battleship', name: 'Windsurf', length: 4 },
  { id: 'cruiser', name: 'DeepWiki', length: 3 },
  { id: 'submarine', name: 'Devin Review', length: 3 },
  { id: 'destroyer', name: 'Devin Oncall', length: 2 },
];

export const ENEMY_FLEET_NAMES: Record<string, string> = {
  carrier: 'Tech Debt',
  battleship: 'Merge Conflict',
  cruiser: 'CVE Backlog',
  submarine: 'Flaky Test',
  destroyer: 'Stale Jira Ticket',
};

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
  Number.isInteger(c.x) &&
  Number.isInteger(c.y) &&
  c.x >= 0 &&
  c.x < GRID_SIZE &&
  c.y >= 0 &&
  c.y < GRID_SIZE;

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
