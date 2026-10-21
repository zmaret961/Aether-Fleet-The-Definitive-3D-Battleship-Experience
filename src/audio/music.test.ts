import { describe, expect, it } from 'vitest';
import { battleIntensity, layerLevel, midiToHz, panForColumn } from './music';

describe('adaptive score maths', () => {
  it('starts tense and climbs as ships sink', () => {
    const start = battleIntensity(5, 5);
    expect(start).toBeCloseTo(0.4);
    expect(battleIntensity(4, 5)).toBeGreaterThan(start);
    expect(battleIntensity(3, 3)).toBeGreaterThan(battleIntensity(4, 4));
  });

  it('peaks when either side is down to its last ship', () => {
    expect(battleIntensity(1, 5)).toBeGreaterThan(0.8);
    expect(battleIntensity(5, 1)).toBeGreaterThan(0.8);
    expect(battleIntensity(1, 1)).toBeLessThanOrEqual(1);
  });

  it('fades layers in over a span', () => {
    expect(layerLevel(0.2, 0.25)).toBe(0);
    expect(layerLevel(0.325, 0.25)).toBeCloseTo(0.5);
    expect(layerLevel(0.9, 0.25)).toBe(1);
  });

  it('tunes A4 to 440 Hz and pans columns symmetrically', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(panForColumn(0, false)).toBeCloseTo(-panForColumn(9, false));
    expect(Math.abs(panForColumn(0, true))).toBeLessThan(Math.abs(panForColumn(0, false)));
  });
});
