import type { Coord } from '../game/types';

/**
 * Fire-and-forget visual event bus. The store emits, the 3D scene subscribes
 * and spawns transient effects (sonar ripples, splashes, explosions).
 */
export type BoardSide = 'player' | 'enemy';

export type FxEvent =
  | { type: 'sonar'; coord: Coord; side: BoardSide }
  | { type: 'splash'; coord: Coord; big?: boolean; side: BoardSide }
  | { type: 'explosion'; coord: Coord; side: BoardSide }
  | { type: 'sink'; coord: Coord; side: BoardSide }
  | { type: 'marker'; coord: Coord; outcome: 'miss' | 'hit'; side: BoardSide };

type Handler = (e: FxEvent) => void;

const handlers = new Set<Handler>();

export const fx = {
  emit(e: FxEvent) {
    handlers.forEach((h) => h(e));
  },
  subscribe(h: Handler): () => void {
    handlers.add(h);
    return () => handlers.delete(h);
  },
};
