import { create } from 'zustand';

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

interface QualityState {
  /** Bloom is the most expensive pass; auto mode drops it if the GPU can't keep up. */
  bloom: boolean;
  setBloom: (bloom: boolean) => void;
}

export const useQuality = create<QualityState>((set) => ({
  bloom: true,
  setBloom: (bloom) => set({ bloom }),
}));

/** SwiftShader/llvmpipe are CI/test renderers: never treat their frame rate as a
 * signal to strip effects, so screenshots match what real GPUs show. */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|software/i.test(renderer);
}
