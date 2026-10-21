import * as THREE from 'three';
import { BOARD_HALF, ENEMY_BOARD_POS, PLAYER_BOARD_POS } from './config';

/** Below this aspect ratio (portrait phones/tablets) the camera is re-framed. */
export const RESPONSIVE_ASPECT = 1.2;

export interface FitResult {
  position: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Camera distance relative to the desktop framing (scales fog). */
  scale: number;
}

interface FitSpec {
  points: THREE.Vector3[];
  /** Screen-space window (NDC) the points must land in, leaving room for HUD. */
  yMin: number;
  yMax: number;
  xMax: number;
  /** How far the look target slides toward the camera so content rides above the bottom HUD. */
  lookShift: number;
}

const rim = BOARD_HALF + 0.35;
const corners = (c: readonly [number, number, number]) =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(c[0] + sx * rim, 0.1, c[2] + sz * rim)));

const SPECS: Record<'deploy' | 'battle', FitSpec> = {
  deploy: { points: corners([0, 0, 0]), yMin: -0.4, yMax: 0.62, xMax: 0.86, lookShift: 2.6 },
  battle: { points: [...corners(PLAYER_BOARD_POS), ...corners(ENEMY_BOARD_POS)], yMin: -0.62, yMax: 0.66, xMax: 0.95, lookShift: 1.4 },
};

const OVERHEAD = new THREE.Vector3(0, 1, 0.32).normalize();
const probe = new THREE.PerspectiveCamera();
const ndc = new THREE.Vector3();
const cache = new Map<string, FitResult>();

function fits(spec: FitSpec): boolean {
  return spec.points.every((p) => {
    ndc.copy(p).project(probe);
    return Math.abs(ndc.x) <= spec.xMax && ndc.y >= spec.yMin && ndc.y <= spec.yMax;
  });
}

/**
 * Re-frames the desktop camera for narrow viewports: tilts toward overhead (the
 * two boards stack naturally in portrait), widens the lens a little, and backs
 * off until every board corner clears the HUD. Desktop framing is untouched.
 */
export function fitCamera(
  mode: 'deploy' | 'battle',
  base: THREE.Vector3,
  look: THREE.Vector3,
  fov: number,
  aspect: number,
): FitResult | null {
  if (aspect >= RESPONSIVE_ASPECT) return null;
  const key = `${mode}:${aspect.toFixed(3)}:${fov}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const spec = SPECS[mode];
  const t = THREE.MathUtils.clamp((RESPONSIVE_ASPECT - aspect) / (RESPONSIVE_ASPECT - 0.5), 0, 1);
  const offset = base.clone().sub(look);
  const baseDist = offset.length();
  const dir = offset.normalize().lerp(OVERHEAD, t * 0.6).normalize();
  const fitLook = look.clone().add(new THREE.Vector3(0, 0, spec.lookShift * t));
  const fitFov = fov + t * 10;

  probe.fov = fitFov;
  probe.aspect = aspect;
  probe.near = 0.1;
  probe.far = 400;
  probe.updateProjectionMatrix();

  let dist = baseDist * 0.8;
  const position = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    position.copy(fitLook).addScaledVector(dir, dist);
    probe.position.copy(position);
    probe.lookAt(fitLook);
    probe.updateMatrixWorld();
    if (fits(spec)) break;
    dist *= 1.04;
  }

  const result = { position, look: fitLook, fov: fitFov, scale: Math.max(1, dist / baseDist) };
  if (cache.size > 64) cache.clear();
  cache.set(key, result);
  return result;
}
