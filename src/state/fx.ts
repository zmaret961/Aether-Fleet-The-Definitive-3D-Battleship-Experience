import type { Coord } from '../game/types';

/**
 * Fire-and-forget visual event bus. The store emits, the 3D scene subscribes
 * and spawns transient effects (sonar ripples, splashes, explosions).
 */
export type FxEvent =
  | { type: 'sonar'; coord: Coord }
  | { type: 'splash'; coord: Coord; big?: boolean }
  | { type: 'explosion'; coord: Coord }
  | { type: 'sink'; coord: Coord }
  | { type: 'marker'; coord: Coord; outcome: 'miss' | 'hit' };

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
