import { FLEET, GRID_SIZE, coordEq, coordKey, inBounds } from './types';
import type { Coord, Orientation, PlacedShip, Rng, ShipSpec, ShotOutcome } from './types';

export interface Board {
  ships: PlacedShip[];
  /** ship id occupying a cell, or null for open water */
  shipAt: (string | null)[][];
  /** what shots fired AT this board produced */
  marks: ('unknown' | 'miss' | 'hit')[][];
}

export const createBoard = (): Board => ({
  ships: [],
  shipAt: Array.from({ length: GRID_SIZE }, () => Array<string | null>(GRID_SIZE).fill(null)),
  marks: Array.from({ length: GRID_SIZE }, () => Array<'unknown' | 'miss' | 'hit'>(GRID_SIZE).fill('unknown')),
});

export const cloneBoard = (b: Board): Board => ({
  ships: b.ships.map((s) => ({ ...s, cells: s.cells.map((c) => ({ ...c })) })),
  shipAt: b.shipAt.map((row) => [...row]),
  marks: b.marks.map((row) => [...row]),
});

export const shipCellsFor = (origin: Coord, orientation: Orientation, length: number): Coord[] => {
  const cells: Coord[] = [];
  for (let i = 0; i < length; i++) {
    cells.push({ x: origin.x + (orientation === 'h' ? i : 0), y: origin.y + (orientation === 'v' ? i : 0) });
  }
  return cells;
};

export const canPlace = (board: Board, origin: Coord, orientation: Orientation, length: number): boolean => {
  const cells = shipCellsFor(origin, orientation, length);
  return cells.every((c) => inBounds(c) && board.shipAt[c.y][c.x] === null);
};

export const placeShip = (board: Board, spec: ShipSpec, origin: Coord, orientation: Orientation): boolean => {
  if (!canPlace(board, origin, orientation, spec.length)) return false;
  const cells = shipCellsFor(origin, orientation, spec.length);
  for (const c of cells) board.shipAt[c.y][c.x] = spec.id;
  board.ships.push({ spec, cells, hits: 0, sunk: false });
  return true;
};

export const removeShip = (board: Board, shipId: string): void => {
  const ship = board.ships.find((s) => s.spec.id === shipId);
  if (!ship) return;
  for (const c of ship.cells) board.shipAt[c.y][c.x] = null;
  board.ships = board.ships.filter((s) => s.spec.id !== shipId);
};

/** All valid placements for a ship of `length`, given occupied cells in `shipAt`. */
export const allPlacements = (
  occupied: (string | null)[][],
  length: number,
): { origin: Coord; orientation: Orientation; cells: Coord[] }[] => {
  const out: { origin: Coord; orientation: Orientation; cells: Coord[] }[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (const orientation of ['h', 'v'] as const) {
        const cells = shipCellsFor({ x, y }, orientation, length);
        if (cells.every((c) => inBounds(c) && occupied[c.y][c.x] === null)) {
          out.push({ origin: { x, y }, orientation, cells });
        }
      }
    }
  }
  return out;
};

export const remainingLengths = (board: Board): number[] =>
  board.ships.filter((s) => !s.sunk).map((s) => s.spec.length);

export const allSunk = (board: Board): boolean => board.ships.length > 0 && board.ships.every((s) => s.sunk);

/**
 * Fire at a board. Mutates the board (call on a mutable match board).
 * 'already' when the cell was previously fired upon.
 */
export const fireAt = (board: Board, c: Coord): ShotOutcome => {
  if (!inBounds(c) || board.marks[c.y][c.x] !== 'unknown') return { kind: 'already' };
  const shipId = board.shipAt[c.y][c.x];
  if (shipId === null) {
    board.marks[c.y][c.x] = 'miss';
    return { kind: 'miss' };
  }
  board.marks[c.y][c.x] = 'hit';
  const ship = board.ships.find((s) => s.spec.id === shipId)!;
  ship.hits += 1;
  if (ship.hits >= ship.spec.length) {
    ship.sunk = true;
    return allSunk(board) ? { kind: 'win', shipId } : { kind: 'sunk', shipId };
  }
  return { kind: 'hit', shipId };
};

/** Deterministic random fleet layout using the provided rng. */
export const randomLayout = (rng: Rng): Board => {
  const board = createBoard();
  // Largest first keeps placement fast and reliable.
  for (const spec of [...FLEET].sort((a, b) => b.length - a.length)) {
    const placements = allPlacements(board.shipAt, spec.length);
    const pick = placements[Math.floor(rng() * placements.length)];
    board.ships.push({ spec, cells: pick.cells, hits: 0, sunk: false });
    for (const c of pick.cells) board.shipAt[c.y][c.x] = spec.id;
  }
  return board;
};

export const shipAtCell = (board: Board, c: Coord): PlacedShip | undefined =>
  board.ships.find((s) => s.cells.some((sc) => coordEq(sc, c)));

export const boardSignature = (board: Board): string =>
  board.ships
    .map((s) => `${s.spec.id}:${s.cells.map(coordKey).sort((a, b) => a - b).join(',')}`)
    .join('|');
