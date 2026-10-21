/**
 * Pure helpers for the adaptive score. Kept free of Web Audio so they can be
 * unit-tested and reasoned about without a browser.
 */

export type MusicMode = 'off' | 'menu' | 'deploy' | 'battle' | 'over';

export const BPM = 96;
export const STEP_SEC = 60 / BPM / 4; // one 16th note
export const STEPS_PER_BAR = 16;

export interface Chord {
  /** bass root (MIDI) */
  root: number;
  /** pad voicing (MIDI), close voice-led triads around D3 */
  pad: number[];
}

/** D minor: i – VI – iv – V (harmonic-minor A major for pull back home). */
export const CALM_PROGRESSION: Chord[] = [
  { root: 38, pad: [50, 53, 57] }, // Dm
  { root: 34, pad: [50, 53, 58] }, // Bb
  { root: 31, pad: [50, 55, 58] }, // Gm
  { root: 33, pad: [49, 52, 57] }, // A
];

/** When our fleet is nearly gone: Neapolitan Eb grinds against D. */
export const DANGER_PROGRESSION: Chord[] = [
  { root: 38, pad: [50, 53, 57] }, // Dm
  { root: 39, pad: [51, 55, 58] }, // Eb
  { root: 38, pad: [50, 53, 57] }, // Dm
  { root: 33, pad: [49, 52, 57] }, // A
];

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0 below `from`, 1 above `from + span`, linear in between. */
export const layerLevel = (intensity: number, from: number, span = 0.15): number =>
  clamp01((intensity - from) / span);

/**
 * Battle intensity from the fleets still afloat (5 ships each).
 * Starts tense (0.4), climbs with every sinking, and spikes when either
 * side is down to its last one or two hulls.
 */
export const battleIntensity = (enemyAfloat: number, playerAfloat: number, fleetSize = 5): number => {
  const sunk = fleetSize - enemyAfloat + (fleetSize - playerAfloat);
  const closest = Math.min(enemyAfloat, playerAfloat);
  const edge = closest <= 1 ? 0.28 : closest === 2 ? 0.12 : 0;
  return clamp01(0.4 + sunk * 0.06 + edge);
};

export const baseIntensity = (mode: MusicMode): number => {
  switch (mode) {
    case 'menu':
      return 0.12;
    case 'deploy':
      return 0.3;
    case 'battle':
      return 0.4;
    case 'over':
      return 0.06;
    default:
      return 0;
  }
};

/** Stereo pan for a board column; the far (enemy) board sits narrower in the image. */
export const panForColumn = (x: number, far: boolean): number => ((x - 4.5) / 4.5) * (far ? 0.38 : 0.62);
