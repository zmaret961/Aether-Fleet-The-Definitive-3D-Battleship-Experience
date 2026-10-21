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

/** Slider position (0..1) to linear gain: a perceptual taper so the travel feels even. */
export const volumeTaper = (v: number): number => Math.pow(clamp01(v), 1.6);

/**
 * Menu / title loop: eight bars instead of four so the harmony keeps moving
 * (Dm – Bb – F – C | Dm – Bb – Gm – A), with a lead theme on every other pass.
 */
export const MENU_PROGRESSION: Chord[] = [
  { root: 38, pad: [50, 53, 57] }, // Dm
  { root: 34, pad: [50, 53, 58] }, // Bb
  { root: 41, pad: [48, 53, 57] }, // F
  { root: 36, pad: [48, 52, 55] }, // C
  { root: 38, pad: [50, 53, 57] }, // Dm
  { root: 34, pad: [50, 53, 58] }, // Bb
  { root: 31, pad: [50, 55, 58] }, // Gm
  { root: 33, pad: [49, 52, 57] }, // A
];

/** [16th-step within the 8-bar phrase, MIDI note, length in 16ths] */
export type ThemeNote = readonly [step: number, midi: number, len: number];

/** "Aether" theme — a slow, singable D-minor line that answers itself in bar 5. */
export const MENU_THEME: readonly ThemeNote[] = [
  [0, 69, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4],
  [16, 70, 8], [24, 65, 4], [28, 67, 4],
  [32, 69, 12], [44, 72, 4],
  [48, 67, 8], [56, 64, 8],
  [64, 69, 6], [70, 74, 2], [72, 77, 4], [76, 76, 4],
  [80, 74, 8], [88, 70, 4], [92, 72, 4],
  [96, 74, 6], [102, 70, 2], [104, 67, 8],
  [112, 73, 4], [116, 76, 4], [120, 74, 8],
];

/** Steps in a full menu cycle: theme pass (8 bars) + sparkle-only pass (8 bars). */
export const MENU_CYCLE_STEPS = STEPS_PER_BAR * 16;

/** Theme notes starting on this step of the menu cycle (none during the answering pass). */
export const themeNotesAt = (step: number): ThemeNote[] => {
  const s = ((step % MENU_CYCLE_STEPS) + MENU_CYCLE_STEPS) % MENU_CYCLE_STEPS;
  if (s >= STEPS_PER_BAR * 8) return [];
  return MENU_THEME.filter((n) => n[0] === s);
};
