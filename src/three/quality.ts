import { create } from 'zustand';

/**
 * Render quality: one place every 3D/FX module reads its budget from.
 *
 *   setting  — what the player picked in Settings: 'auto' | 'high' | 'low'
 *   tier     — what is actually rendered:        'high' | 'medium' | 'low'
 *   profile  — the concrete budget for that tier (QualityProfile below)
 *
 * React:      const { particles, shadows } = useQualityProfile();
 *             const tier = useQuality((s) => s.tier);
 * Non-React:  getQualityProfile().particles   (e.g. inside an fx.subscribe handler)
 * CSS:        html[data-quality='low'] … (set on <html> whenever the tier changes)
 *
 * Auto starts from the device class (desktop → high, phone/tablet or a
 * 4-core / 4 GB machine → medium, both → low) and steps down one tier at a time when the
 * frame rate can't hold (`degrade()`, driven by drei's PerformanceMonitor in Scene).
 */
export type QualitySetting = 'auto' | 'high' | 'low';
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualityProfile {
  tier: QualityTier;
  /** Upper bound for the canvas device-pixel ratio (already clamped to the screen's). */
  maxDpr: number;
  /** Floor AdaptiveDpr may drop to while holding frame rate. */
  minDpr: number;
  /** Directional-light shadow map; 0 = shadows off. */
  shadowMapSize: 0 | 1024 | 2048;
  /** Image-based lighting from the Lightformer studio environment. */
  envMap: boolean;
  /** EffectComposer (vignette + SMAA) at all. */
  postfx: boolean;
  /** Bloom pass inside the composer (the most expensive pass). */
  bloom: boolean;
  /** Ocean plane subdivisions per side. */
  oceanSegments: number;
  /** Ocean caustic/sparkle strength, 0..1. */
  caustics: number;
  /** Multiplier for particle counts in bursts, 0..1. Round the result and keep ≥ 1. */
  particles: number;
  /** Max simultaneous transient fx groups before old ones are culled. */
  maxEffects: number;
  /** Pooled flash point-lights may animate (count stays fixed so shaders never recompile). */
  flashLights: boolean;
}

export interface DeviceProfile {
  /** Phone or small tablet driven by touch. */
  mobile: boolean;
  /** Few cores or little memory: keep the pixel budget tight. */
  lowEnd: boolean;
  /** Upper bound for the canvas device-pixel ratio. */
  maxDpr: number;
}

export function detectDevice(): DeviceProfile {
  if (typeof window === 'undefined') return { mobile: false, lowEnd: false, maxDpr: 2 };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mobile = coarse && Math.min(window.screen.width, window.screen.height) < 820;
  const lowEnd = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  const maxDpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : mobile ? 1.75 : 2);
  return { mobile, lowEnd, maxDpr };
}

export const DEVICE = detectDevice();

const PROFILES: Record<QualityTier, Omit<QualityProfile, 'maxDpr'> & { dprCap: number }> = {
  high: {
    tier: 'high', dprCap: 2, minDpr: 0.8, shadowMapSize: 2048, envMap: true, postfx: true, bloom: true,
    oceanSegments: 128, caustics: 1, particles: 1, maxEffects: 48, flashLights: true,
  },
  medium: {
    tier: 'medium', dprCap: 1.5, minDpr: 0.75, shadowMapSize: 1024, envMap: true, postfx: true, bloom: true,
    oceanSegments: 96, caustics: 0.8, particles: 0.65, maxEffects: 28, flashLights: true,
  },
  low: {
    tier: 'low', dprCap: 1, minDpr: 0.7, shadowMapSize: 0, envMap: false, postfx: false, bloom: false,
    oceanSegments: 64, caustics: 0.4, particles: 0.35, maxEffects: 14, flashLights: false,
  },
};

const ORDER: QualityTier[] = ['high', 'medium', 'low'];

export function profileFor(tier: QualityTier, device: DeviceProfile = DEVICE): QualityProfile {
  const { dprCap, ...rest } = PROFILES[tier];
  return { ...rest, maxDpr: Math.min(device.maxDpr, dprCap) };
}

/** Tier Auto starts at before any frame-rate feedback. */
export function autoTier(device: DeviceProfile = DEVICE): QualityTier {
  if (device.lowEnd && device.mobile) return 'low';
  return device.lowEnd || device.mobile ? 'medium' : 'high';
}

/** `steps` = how many times Auto has degraded because the GPU couldn't keep up. */
export function resolveTier(setting: QualitySetting, device: DeviceProfile = DEVICE, steps = 0): QualityTier {
  if (setting === 'high') return 'high';
  if (setting === 'low') return 'low';
  const start = ORDER.indexOf(autoTier(device));
  return ORDER[Math.min(ORDER.length - 1, start + Math.max(0, steps))];
}

interface QualityState {
  setting: QualitySetting;
  tier: QualityTier;
  profile: QualityProfile;
  /** Auto-mode degradation steps taken this session. */
  steps: number;
  /** Bloom as currently rendered (profile.bloom, or false after an Auto fallback). Kept for PostFX. */
  bloom: boolean;
  setSetting: (setting: QualitySetting) => void;
  /** Auto only: drop one tier. Returns false if already at the floor or not in Auto. */
  degrade: () => boolean;
  setBloom: (bloom: boolean) => void;
}

const build = (setting: QualitySetting, steps: number) => {
  const tier = resolveTier(setting, DEVICE, steps);
  const profile = profileFor(tier);
  return { setting, steps, tier, profile, bloom: profile.bloom };
};

export const useQuality = create<QualityState>((set, get) => ({
  ...build('auto', 0),
  setSetting: (setting) => {
    if (setting !== get().setting) set(build(setting, 0));
  },
  degrade: () => {
    const { setting, steps, tier } = get();
    if (setting !== 'auto' || tier === 'low') return false;
    set(build(setting, steps + 1));
    return true;
  },
  setBloom: (bloom) => set({ bloom: bloom && get().profile.bloom }),
}));

export const useQualityProfile = () => useQuality((s) => s.profile);
export const getQualityProfile = () => useQuality.getState().profile;
export const getQualityTier = () => useQuality.getState().tier;

/** Scale a particle count by the current tier (never below 1). */
export const scaleCount = (count: number) => Math.max(1, Math.round(count * getQualityProfile().particles));

if (typeof document !== 'undefined') {
  const mark = (tier: QualityTier) => document.documentElement.setAttribute('data-quality', tier);
  mark(useQuality.getState().tier);
  useQuality.subscribe((s, prev) => {
    if (s.tier !== prev.tier) mark(s.tier);
  });
}

/** SwiftShader/llvmpipe are CI/test renderers: never treat their frame rate as a
 * signal to strip effects, so screenshots match what real GPUs show. */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|software/i.test(renderer);
}
