import * as THREE from 'three';
import {
  BOARD_HALF,
  ENEMY_BOARD_POS,
  LEGACY_MONOLITH_POSITION,
  LEGACY_MONOLITH_SCALE,
  PLAYER_BOARD_POS,
  PLAYER_BOARD_SCALE,
} from './config';

/** Below this aspect ratio (portrait phones/tablets) the camera tilts toward overhead. */
export const RESPONSIVE_ASPECT = 1.2;

/** Tailwind `lg` — the side HUD panels only exist at or above this width. */
const LG = 1024;
const XL = 1280;

export interface FitResult {
  position: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Camera distance relative to the reference desktop framing (scales fog). */
  scale: number;
}

/** A point that must land inside a screen window (in NDC). */
interface Target {
  p: THREE.Vector3;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const rimCorners = (c: readonly [number, number, number], scale: number, y = 0.1) => {
  const r = (BOARD_HALF + 0.7) * scale;
  return [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(c[0] + sx * r, y, c[2] + sz * r)));
};

const ndcX = (px: number, w: number) => (px / w) * 2 - 1;
const ndcY = (px: number, h: number) => 1 - (px / h) * 2;

/**
 * Screen windows mirror the HUD in BattleScreen/DeployScreen: top status
 * banner, bottom firing bar, and the lg+ side panels. Board corners must stay
 * clear of all of them so every cell is visible and clickable.
 */
function targets(mode: 'deploy' | 'battle', w: number, h: number): Target[] {
  const lg = w >= LG;
  if (mode === 'deploy') {
    const panel = lg ? (w >= XL ? 24 + 320 : 24 + 288) + 22 : 14;
    const top = lg ? 150 : w < 640 ? 130 : 150;
    const bottom = lg ? 24 : Math.min(330, h * 0.36);
    const right = lg ? 24 : 14;
    const win = { xMin: ndcX(panel, w), xMax: ndcX(w - right, w), yMin: ndcY(h - bottom, h), yMax: ndcY(top, h) };
    return rimCorners([0, 0, 0], 1).map((p) => ({ p, ...win }));
  }
  const side = lg ? (w >= XL ? 20 + 288 : 20 + 256) + 18 : 10;
  const top = lg ? 128 : w < 640 ? 150 : 130;
  const bottom = w < 640 ? 92 : 96;
  const board = { xMin: ndcX(side, w), xMax: ndcX(w - side, w), yMin: ndcY(h - bottom, h), yMax: ndcY(top, h) };
  // the boss keeps its face clear of the status banner; its crown may tuck under it
  const faceY = LEGACY_MONOLITH_POSITION[1] + 4.6 * LEGACY_MONOLITH_SCALE[1];
  const boss = new THREE.Vector3(LEGACY_MONOLITH_POSITION[0], faceY, LEGACY_MONOLITH_POSITION[2] + 1.2 * LEGACY_MONOLITH_SCALE[2]);
  return [
    ...rimCorners(ENEMY_BOARD_POS, 1).map((p) => ({ p, ...board })),
    ...rimCorners(PLAYER_BOARD_POS, PLAYER_BOARD_SCALE).map((p) => ({ p, ...board })),
    { p: boss, xMin: -1, xMax: 1, yMin: -1, yMax: ndcY(lg ? 96 : top * 0.75, h) },
  ];
}

interface Lens {
  /** Camera elevation above the horizon (radians). */
  elev: number;
  fov: number;
  look: THREE.Vector3;
}

/** Desktop lenses; portrait viewports blend toward a steeper, wider shot. */
const LENS: Record<'deploy' | 'battle', { wide: Lens; tall: Lens }> = {
  deploy: {
    wide: { elev: THREE.MathUtils.degToRad(51), fov: 40, look: new THREE.Vector3(0, 0, 0.4) },
    tall: { elev: THREE.MathUtils.degToRad(64), fov: 46, look: new THREE.Vector3(0, 0, 0.4) },
  },
  battle: {
    wide: { elev: THREE.MathUtils.degToRad(43), fov: 36, look: new THREE.Vector3(0, 0, 0) },
    tall: { elev: THREE.MathUtils.degToRad(62), fov: 46, look: new THREE.Vector3(0, 0, 0) },
  },
};

/** Desktop reference distance used for fog scaling. */
const REF_DIST = { deploy: 21, battle: 34 };

const probe = new THREE.PerspectiveCamera();
const ndc = new THREE.Vector3();
const cache = new Map<string, FitResult>();

/**
 * Solves a camera for any viewport: picks a lens from the aspect ratio, then
 * iterates distance and target until every board corner lands inside the
 * HUD-free window, centred in it. Cached per mode + viewport size.
 */
export function fitCamera(mode: 'deploy' | 'battle', width: number, height: number): FitResult {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const key = `${mode}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const aspect = w / h;
  const t = THREE.MathUtils.clamp((RESPONSIVE_ASPECT - aspect) / (RESPONSIVE_ASPECT - 0.46), 0, 1);
  const { wide, tall } = LENS[mode];
  const elev = THREE.MathUtils.lerp(wide.elev, tall.elev, t);
  const fov = THREE.MathUtils.lerp(wide.fov, tall.fov, t);
  const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
  const look = wide.look.clone().lerp(tall.look, t);
  const pts = targets(mode, w, h);

  probe.fov = fov;
  probe.aspect = aspect;
  probe.near = 0.1;
  probe.far = 400;
  probe.updateProjectionMatrix();
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));

  let dist = REF_DIST[mode];
  const position = new THREE.Vector3();
  for (let i = 0; i < 48; i++) {
    position.copy(look).addScaledVector(dir, dist);
    probe.position.copy(position);
    probe.lookAt(look);
    probe.updateMatrixWorld();

    // worst overshoot of any point beyond its window, measured from window centre
    let k = 0;
    let dxSum = 0;
    let dySum = 0;
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (const tg of pts) {
      ndc.copy(tg.p).project(probe);
      const cx = (tg.xMin + tg.xMax) / 2;
      const cy = (tg.yMin + tg.yMax) / 2;
      const hx = (tg.xMax - tg.xMin) / 2;
      const hy = (tg.yMax - tg.yMin) / 2;
      k = Math.max(k, Math.abs(ndc.x - cx) / hx, Math.abs(ndc.y - cy) / hy);
      // only real window edges count toward re-centring (the boss has an open bottom)
      if (tg.yMin > -1) lo = Math.min(lo, ndc.y - tg.yMin);
      if (tg.yMax < 1) hi = Math.max(hi, ndc.y - tg.yMax);
      if (tg.xMin > -1) left = Math.min(left, ndc.x - tg.xMin);
      if (tg.xMax < 1) right = Math.max(right, ndc.x - tg.xMax);
      n++;
    }
    // re-centre: equalise the slack between the highest and lowest bound points,
    // so the boss face and the near board edge share the frame instead of wasting the bottom
    if (n && Number.isFinite(lo) && Number.isFinite(hi)) dySum = (lo + hi) / 2;
    if (n && Number.isFinite(left) && Number.isFinite(right)) dxSum = (left + right) / 2;
    const span = dist * tanHalf;
    look.z -= (dySum * span) / Math.max(Math.sin(elev), 0.3) * 0.7;
    look.x += dxSum * span * aspect * 0.7;
    const next = dist * (1 + (k - 0.97) * 0.55);
    if (Math.abs(k - 0.97) < 0.006 && Math.abs(dySum) < 0.01 && Math.abs(dxSum) < 0.01) break;
    dist = THREE.MathUtils.clamp(next, 6, 160);
  }
  position.copy(look).addScaledVector(dir, dist);

  const result = { position, look, fov, scale: Math.max(1, dist / REF_DIST[mode]) };
  if (cache.size > 64) cache.clear();
  cache.set(key, result);
  return result;
}
