import { describe, expect, it } from 'vitest';
import { autoTier, profileFor, resolveTier, scaleCount, useQuality, type DeviceProfile } from './quality';

const desktop: DeviceProfile = { mobile: false, lowEnd: false, maxDpr: 2 };
const phone: DeviceProfile = { mobile: true, lowEnd: false, maxDpr: 3 };
const weak: DeviceProfile = { mobile: true, lowEnd: true, maxDpr: 1.25 };

describe('quality tiers', () => {
  it('auto picks a tier from the device class', () => {
    expect(autoTier(desktop)).toBe('high');
    expect(autoTier(phone)).toBe('medium');
    expect(autoTier(weak)).toBe('low');
    expect(autoTier({ ...desktop, lowEnd: true })).toBe('medium');
  });

  it('explicit High/Low ignore the device and degradation', () => {
    expect(resolveTier('high', weak, 5)).toBe('high');
    expect(resolveTier('low', desktop)).toBe('low');
  });

  it('auto steps down one tier per degrade and floors at low', () => {
    expect(resolveTier('auto', desktop, 0)).toBe('high');
    expect(resolveTier('auto', desktop, 1)).toBe('medium');
    expect(resolveTier('auto', desktop, 9)).toBe('low');
  });

  it('profiles get cheaper monotonically and respect the screen DPR', () => {
    const [h, m, l] = (['high', 'medium', 'low'] as const).map((t) => profileFor(t, phone));
    expect(h.particles).toBeGreaterThan(m.particles);
    expect(m.particles).toBeGreaterThan(l.particles);
    expect(h.shadowMapSize).toBeGreaterThanOrEqual(m.shadowMapSize);
    expect(l.shadowMapSize).toBe(0);
    expect(l.postfx).toBe(false);
    expect(profileFor('high', weak).maxDpr).toBe(1.25);
    expect(m.maxDpr).toBeLessThanOrEqual(1.5);
  });

  it('store: setting + degrade + scaleCount', () => {
    const q = useQuality.getState();
    q.setSetting('low');
    expect(useQuality.getState().tier).toBe('low');
    expect(useQuality.getState().degrade()).toBe(false);
    expect(scaleCount(100)).toBe(35);
    expect(scaleCount(1)).toBe(1);
    q.setSetting('high');
    expect(useQuality.getState().degrade()).toBe(false);
    expect(scaleCount(100)).toBe(100);
    useQuality.getState().setSetting('auto');
  });
});
