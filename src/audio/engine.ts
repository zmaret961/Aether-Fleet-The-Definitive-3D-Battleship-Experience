/**
 * Procedural Web Audio engine — every sound is synthesized, no asset files.
 *
 * Signal flow:
 *   sfx / ui / ambient ─► SFX group ─┐
 *   score ─► duck ─► pause tone ─┐   │
 *   stingers ────────────────────┴► MUSIC group ─┴► mix ─► glue comp ─► limiter ─► soft clip ─► master ─► out
 *   reverb sends (scaled by their group's volume) ─► convolver (generated hall IR) ─► mix
 *
 * The AudioContext is only created inside a real user gesture (see
 * installGestureUnlock) so browsers never log autoplay warnings. The same
 * engine can be pointed at an OfflineAudioContext to render the mix to a file
 * (see ./offline.ts), which is how loudness is calibrated.
 */
import type { BossMood } from '../state/fx';
import { MISSILE_FLIGHT_MS } from '../state/fx';
import type { CommanderId } from '../game/types';
import {
  CALM_PROGRESSION,
  DANGER_PROGRESSION,
  MENU_PROGRESSION,
  MENU_CYCLE_STEPS,
  STEP_SEC,
  STEPS_PER_BAR,
  baseIntensity,
  clamp01,
  layerLevel,
  midiToHz,
  themeNotesAt,
  volumeTaper,
} from './music';
import type { MusicMode } from './music';

export type AudioSide = 'player' | 'enemy';
export type { MusicMode } from './music';

type Ctx = BaseAudioContext;

interface Place {
  pan?: number;
  /** 0 = right in front of us (our board), 1 = across the water (enemy board / Monolith) */
  far?: number;
}

interface Strip {
  input: GainNode;
  nodes: AudioNode[];
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  glide?: number;
  at: number;
  attack?: number;
  dur: number;
  peak: number;
  out: AudioNode;
  detune?: number;
}

interface BurstOpts {
  at: number;
  attack?: number;
  dur: number;
  peak: number;
  out: AudioNode;
  filter: BiquadFilterType;
  freq: number;
  to?: number;
  q?: number;
  brown?: boolean;
}

interface Timer {
  at: number;
  fn: () => void;
  dead: boolean;
}

const LOOKAHEAD_SEC = 0.3;
const SCHEDULER_MS = 40;
/** Make-up gain into the glue compressor; calibrated offline to ≈ -16 LUFS for a battle at default settings. */
const MIX_GAIN = 1.3;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Minimum seconds between two voicings of the same boss mood (moods can flip every shot). */
const MOOD_COOLDOWN: Record<BossMood, number> = {
  smug: 7,
  laugh: 2.2,
  gloat: 2.2,
  hurt: 0.9,
  rage: 1.5,
  charge: 1.2,
  dead: 99,
  victory: 99,
};

export class AudioEngine {
  private ctx: Ctx | null = null;
  private readonly offline: boolean;
  private timers: Timer[] = [];
  private outGain: GainNode | null = null;
  private mix: GainNode | null = null;
  private sfxGroup: GainNode | null = null;
  private musicGroup: GainNode | null = null;
  private sfxVerb: GainNode | null = null;
  private musicVerb: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private musicTone: BiquadFilterNode | null = null;
  private stingBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private shaper: Float32Array<ArrayBuffer> | null = null;
  private crusher: Float32Array<ArrayBuffer> | null = null;

  private ambientStarted = false;
  private unlockInstalled = false;
  private _volume = 0.8;
  private _musicVolume = 0.8;
  private _sfxVolume = 0.9;
  private _muted = false;
  private _paused = false;
  private lastHover = 0;
  private lastUi = 0;
  private lastMood: Partial<Record<BossMood, number>> = {};
  private lastMotif = 0;

  // --- adaptive score state ---
  private musicMode: MusicMode = 'off';
  private musicTarget = 0;
  private musicLevel = 0;
  private musicBump = 0;
  private danger = false;
  private step = 0;
  private nextStepAt = 0;
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private musicResumeTimer: (() => void) | null = null;

  constructor(offlineCtx?: OfflineAudioContext) {
    this.offline = !!offlineCtx;
    if (offlineCtx) this.build(offlineCtx);
  }

  // ---------------------------------------------------------------------------
  // Context lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates (or resumes) the context. Only call from inside a user gesture —
   * installGestureUnlock() does that for you on the first real activation.
   */
  unlock(): Ctx | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.build(ctx);
      document.addEventListener('visibilitychange', () => {
        const c = this.ctx as AudioContext | null;
        if (!c) return;
        if (document.hidden) void c.suspend();
        else void c.resume();
      });
    }
    const c = this.ctx as AudioContext;
    if (!this.offline && c.state === 'suspended' && !document.hidden) void c.resume();
    return this.ctx;
  }

  /**
   * Listens for the first event that actually grants user activation
   * (pointerup/keydown/touchend/click — not hover, not Escape) and unlocks
   * audio from inside it. Idempotent.
   */
  installGestureUnlock(onUnlock?: () => void): () => void {
    if (typeof window === 'undefined' || this.unlockInstalled) return () => {};
    this.unlockInstalled = true;
    const events = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const;
    const off = () => events.forEach((e) => window.removeEventListener(e, handler, true));
    const handler = (ev: Event) => {
      const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
      if (ua ? !ua.isActive : ev.type === 'keydown' && (ev as KeyboardEvent).key === 'Escape') return;
      if (!this.unlock()) return;
      off();
      onUnlock?.();
    };
    events.forEach((e) => window.addEventListener(e, handler, true));
    return () => {
      off();
      this.unlockInstalled = false;
    };
  }

  get unlocked() {
    return !!this.ctx;
  }

  /** Context-time timer; works for both realtime and offline rendering. Returns a cancel fn. */
  private later(fn: () => void, ms: number): () => void {
    if (!this.offline) {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    }
    const t: Timer = { at: (this.ctx?.currentTime ?? 0) + ms / 1000, fn, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  }

  /** Offline rendering only: fire due timers and run the score scheduler. */
  pump() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const due = this.timers.filter((t) => t.at <= now);
    this.timers = this.timers.filter((t) => t.at > now);
    due.forEach((t) => !t.dead && t.fn());
    if (this.musicMode !== 'off' || this.ambientStarted) this.schedule();
  }

  private build(ctx: Ctx) {
    this.ctx = ctx;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 3.5;
    glue.attack.value = 0.006;
    glue.release.value = 0.28;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    // Catches the few overs the compressor-limiter lets through, so it never hard-clips.
    const clip = ctx.createWaveShaper();
    clip.curve = this.softClipCurve();
    clip.oversample = '2x';

    this.outGain = ctx.createGain();
    this.outGain.gain.value = this.masterGain();
    this.mix = ctx.createGain();
    this.mix.gain.value = MIX_GAIN;
    this.mix.connect(glue).connect(limiter).connect(clip).connect(this.outGain).connect(ctx.destination);

    const bus = (level: number, dest: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(dest);
      return g;
    };
    this.sfxGroup = bus(volumeTaper(this._sfxVolume), this.mix);
    this.musicGroup = bus(volumeTaper(this._musicVolume), this.mix);

    this.sfxBus = bus(0.95, this.sfxGroup);
    this.uiBus = bus(0.55, this.sfxGroup);
    this.ambientBus = bus(0.5, this.sfxGroup);

    this.musicTone = ctx.createBiquadFilter();
    this.musicTone.type = 'lowpass';
    this.musicTone.frequency.value = 20000;
    this.musicTone.Q.value = 0.5;
    this.musicTone.connect(this.musicGroup);
    this.musicDuck = bus(1, this.musicTone);
    this.musicBus = bus(0, this.musicDuck);
    this.stingBus = bus(0.9, this.musicGroup);

    const verb = ctx.createConvolver();
    verb.buffer = this.hallImpulse(ctx, 3.2);
    const verbTone = ctx.createBiquadFilter();
    verbTone.type = 'lowpass';
    verbTone.frequency.value = 5200;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.reverbIn.connect(verb).connect(verbTone).connect(bus(0.42, this.mix));
    // Sends are scaled by their group's slider so "SFX 0" really silences SFX tails too.
    this.sfxVerb = bus(volumeTaper(this._sfxVolume), this.reverbIn);
    this.musicVerb = bus(volumeTaper(this._musicVolume), this.reverbIn);

    this.white = this.noiseBuffer(ctx, 2, false);
    this.brown = this.noiseBuffer(ctx, 4, true);
    this.shaper = this.saturationCurve(2.6);
    this.crusher = this.crushCurve(7);
  }

  // ---------------------------------------------------------------------------
  // Levels
  // ---------------------------------------------------------------------------

  private masterGain() {
    return this._muted ? 0 : volumeTaper(this._volume);
  }

  private glide(param: AudioParam | undefined, v: number, tc = 0.04) {
    if (param && this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  setVolume(v: number) {
    this._volume = clamp01(v);
    this.glide(this.outGain?.gain, this.masterGain());
  }

  setMusicVolume(v: number) {
    this._musicVolume = clamp01(v);
    this.glide(this.musicGroup?.gain, volumeTaper(this._musicVolume));
    this.glide(this.musicVerb?.gain, volumeTaper(this._musicVolume));
  }

  setSfxVolume(v: number) {
    this._sfxVolume = clamp01(v);
    this.glide(this.sfxGroup?.gain, volumeTaper(this._sfxVolume));
    this.glide(this.sfxVerb?.gain, volumeTaper(this._sfxVolume));
  }

  setMuted(m: boolean) {
    this._muted = m;
    this.glide(this.outGain?.gain, this.masterGain());
  }

  /** Pause menu: the score sinks "underwater" and the world goes quiet. */
  setPaused(p: boolean) {
    if (p === this._paused) return;
    this._paused = p;
    if (!this.ctx || !this.musicTone) return;
    const t = this.ctx.currentTime;
    const f = this.musicTone.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(p ? 520 : 20000, t + (p ? 0.5 : 0.8));
    this.glide(this.sfxGroup?.gain, p ? volumeTaper(this._sfxVolume) * 0.45 : volumeTaper(this._sfxVolume), 0.2);
  }

  get muted() {
    return this._muted;
  }

  get volume() {
    return this._volume;
  }

  private silent() {
    return this._muted || this._volume <= 0.001;
  }

  /** Live context for SFX, or null when silent / not yet unlocked (saves CPU). */
  private live(): Ctx | null {
    if (this.silent() || this._sfxVolume <= 0.001) return null;
    return this.ctx;
  }

  /** Live context for musical stingers (follows the Music slider). */
  private liveMusic(): Ctx | null {
    if (this.silent() || this._musicVolume <= 0.001) return null;
    return this.ctx;
  }

  private verbFor(bus: AudioNode): AudioNode {
    return bus === this.musicBus || bus === this.stingBus ? this.musicVerb! : this.sfxVerb!;
  }

  private softClipCurve(): Float32Array<ArrayBuffer> {
    // Linear to -3 dBFS, then a tanh knee that never exceeds -0.5 dBFS.
    const n = 2048;
    const curve = new Float32Array(n);
    const knee = 0.708;
    const ceil = 0.944;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
      curve[i] = Math.sign(x) * y;
    }
    return curve;
  }

  /** Stepped transfer curve — a cheap bit-crusher for the Monolith's 8-bit voice. */
  private crushCurve(levels: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    return curve;
  }

  private noiseBuffer(ctx: Ctx, seconds: number, brown: boolean): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.4;
        } else d[i] = w;
      }
    }
    return buf;
  }

  private hallImpulse(ctx: Ctx, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // darker as it decays, like a real large space
        const coeff = 0.55 - 0.4 * t;
        lp += coeff * (Math.random() * 2 - 1 - lp);
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 1.5 : 0;
        d[i] = (lp + early * (Math.random() - 0.5)) * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  private saturationCurve(k: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  /**
   * A short-lived channel strip: input → (air-absorption lowpass) → panner → bus,
   * plus a reverb send that grows with distance. Auto-disconnects after `life`.
   */
  private strip(ctx: Ctx, bus: AudioNode, place: Place, life: number, send = 0.25): Strip {
    const far = clamp01(place.far ?? 0);
    const input = ctx.createGain();
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 18000 - far * 12500;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, place.pan ?? 0));
    const sendGain = ctx.createGain();
    sendGain.gain.value = send + far * 0.35;
    input.connect(air).connect(pan).connect(bus);
    pan.connect(sendGain).connect(this.verbFor(bus));
    const nodes = [input, air, pan, sendGain];
    this.later(() => nodes.forEach((n) => n.disconnect()), (life + 3.5) * 1000);
    return { input, nodes };
  }

  private env(param: AudioParam, at: number, attack: number, peak: number, dur: number) {
    param.cancelScheduledValues(at);
    param.setValueAtTime(0.0001, at);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + Math.max(attack, 0.001));
    param.exponentialRampToValueAtTime(0.0001, at + Math.max(attack, 0.001) + dur);
  }

  private tone(ctx: Ctx, o: ToneOpts): OscillatorNode {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.min(o.freq, ctx.sampleRate * 0.45), o.at);
    if (o.detune) osc.detune.value = o.detune;
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), o.at + (o.glide ?? o.dur));
    const g = ctx.createGain();
    this.env(g.gain, o.at, o.attack ?? 0.004, o.peak, o.dur);
    osc.connect(g).connect(o.out);
    osc.start(o.at);
    osc.stop(o.at + (o.attack ?? 0.004) + o.dur + 0.05);
    osc.onended = () => g.disconnect();
    return osc;
  }

  private burst(ctx: Ctx, o: BurstOpts): BiquadFilterNode {
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.brown : this.white;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.freq, o.at);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), o.at + o.dur);
    if (o.q) f.Q.value = o.q;
    const g = ctx.createGain();
    this.env(g.gain, o.at, o.attack ?? 0.003, o.peak, o.dur);
    src.connect(f).connect(g).connect(o.out);
    const total = (o.attack ?? 0.003) + o.dur + 0.05;
    src.start(o.at, Math.random() * (src.buffer!.duration - 0.1));
    src.stop(o.at + total);
    src.onended = () => {
      f.disconnect();
      g.disconnect();
    };
    return f;
  }

  private saturate(ctx: Ctx, out: AudioNode): WaveShaperNode {
    const ws = ctx.createWaveShaper();
    ws.curve = this.shaper;
    ws.oversample = '2x';
    ws.connect(out);
    return ws;
  }

  /** Sidechain-style dip on the score so impacts punch through. */
  private duck(depth: number, hold: number, release: number) {
    if (!this.ctx || !this.musicDuck) return;
    const g = this.musicDuck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.03);
    g.setValueAtTime(1 - depth, t + hold);
    g.linearRampToValueAtTime(1, t + hold + release);
  }

  private bubbles(ctx: Ctx, out: AudioNode, at: number, count: number, span: number, peak: number) {
    for (let i = 0; i < count; i++) {
      const f = rand(260, 820);
      this.tone(ctx, {
        freq: f,
        to: f * rand(1.4, 2.1),
        at: at + Math.pow(Math.random(), 1.4) * span,
        attack: 0.004,
        dur: rand(0.03, 0.08),
        peak: peak * rand(0.4, 1),
        out,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Ambience
  // ---------------------------------------------------------------------------

  /** Call from any user gesture. Starts the deep-ocean bed and the score once. */
  startAmbient() {
    const ctx = this.offline ? this.ctx : this.unlock();
    if (!ctx || !this.ambientBus || this.ambientStarted) return;
    this.ambientStarted = true;

    // Two decorrelated brown-noise beds, panned wide, each with its own slow swell.
    [
      { pan: -0.65, rate: 0.053, cut: 210 },
      { pan: 0.65, rate: 0.081, cut: 260 },
    ].forEach(({ pan, rate, cut }, i) => {
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cut;
      lp.Q.value = 0.4;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const g = ctx.createGain();
      g.gain.value = 0.32;
      src.connect(lp).connect(g).connect(p).connect(this.ambientBus!);
      src.start(0, i * 1.7);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = cut * 0.45;
      lfo.connect(depth).connect(lp.frequency);
      lfo.start();
      const swell = ctx.createOscillator();
      swell.frequency.value = rate * 1.9;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = 0.1;
      swell.connect(swellDepth).connect(g.gain);
      swell.start();
    });

    // Faint surface wash — breaking waves far away.
    const wash = ctx.createBufferSource();
    wash.buffer = this.white;
    wash.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.012;
    wash.connect(bp).connect(wg).connect(this.ambientBus);
    wash.start();
    const waveLfo = ctx.createOscillator();
    waveLfo.frequency.value = 0.13;
    const waveDepth = ctx.createGain();
    waveDepth.gain.value = 0.01;
    waveLfo.connect(waveDepth).connect(wg.gain);
    waveLfo.start();

    const loop = () => {
      this.distantSonar();
      this.later(loop, rand(9000, 15000));
    };
    this.later(loop, 4000);

    this.startScore();
  }

  setAmbientLevel(v: number) {
    // Callers historically passed ~0.16–0.2; normalise to the new bus gain.
    if (this.ambientBus && this.ctx) this.ambientBus.gain.setTargetAtTime(clamp01(v * 3), this.ctx.currentTime, 0.6);
  }

  private distantSonar() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const s = this.strip(ctx, this.ambientBus!, { pan: rand(-0.7, 0.7), far: 1 }, 3, 0.7);
    this.tone(ctx, { freq: 840, at: t, attack: 0.01, dur: 1.8, peak: 0.08, out: s.input });
    this.tone(ctx, { freq: 1683, at: t, attack: 0.01, dur: 1.1, peak: 0.02, out: s.input });
  }

  // ---------------------------------------------------------------------------
  // Adaptive score
  // ---------------------------------------------------------------------------

  private startScore() {
    const ctx = this.ctx;
    if (!ctx || this.schedTimer) return;
    this.nextStepAt = ctx.currentTime + 0.1;
    if (!this.offline) this.schedTimer = setInterval(() => this.schedule(), SCHEDULER_MS);
    if (this.musicMode === 'off') this.setMusicMode('menu');
    else this.applyMusicBus(1.2);
  }

  private applyMusicBus(fade: number) {
    if (!this.ctx || !this.musicBus) return;
    const level = this.musicMode === 'off' ? 0 : this.musicMode === 'over' ? 0.5 : this.musicMode === 'menu' ? 1 : 0.8;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(level, t + fade);
  }

  /** Switch the score's scene. Battle intensity is then driven by setIntensity(). */
  setMusicMode(mode: MusicMode) {
    if (mode === this.musicMode) return;
    const prev = this.musicMode;
    this.musicMode = mode;
    this.musicTarget = baseIntensity(mode);
    if (mode !== 'battle') this.danger = false;
    this.musicResumeTimer?.();
    this.musicResumeTimer = null;
    if (!this.ctx || !this.musicBus) return;
    if (mode === 'over') {
      // Let the victory/defeat stinger ring alone, then return with a quiet outro bed.
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
      this.musicBus.gain.linearRampToValueAtTime(0, t + 0.35);
      this.musicResumeTimer = this.later(() => {
        this.musicLevel = 0.06;
        this.applyMusicBus(4);
      }, 4200);
      return;
    }
    if (prev === 'over' || prev === 'off') this.musicLevel = this.musicTarget;
    this.applyMusicBus(prev === 'over' ? 2 : 1.2);
  }

  get musicScene(): MusicMode {
    return this.musicMode;
  }

  /** 0..1 — how tight the battle is. `danger` = our fleet is nearly gone. */
  setIntensity(v: number, danger = false) {
    this.musicTarget = clamp01(v);
    this.danger = danger;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    // After a stall (tab hidden / heavy frame) don't fire a backlog of notes.
    if (this.nextStepAt < ctx.currentTime - 0.2) this.nextStepAt = ctx.currentTime + 0.05;
    while (this.nextStepAt < ctx.currentTime + LOOKAHEAD_SEC) {
      this.musicLevel += (this.musicTarget + this.musicBump - this.musicLevel) * 0.06;
      this.musicBump *= 0.94;
      if (this.musicMode !== 'off' && !this.silent() && this._musicVolume > 0.001) this.playStep(ctx, this.step, this.nextStepAt);
      this.step = (this.step + 1) % MENU_CYCLE_STEPS;
      this.nextStepAt += STEP_SEC;
    }
  }

  private playStep(ctx: Ctx, step: number, t: number) {
    const bus = this.musicBus!;
    const I = this.musicLevel;
    const inBar = step % STEPS_PER_BAR;
    const calm = this.musicMode === 'menu' || this.musicMode === 'over';
    const prog = this.danger ? DANGER_PROGRESSION : calm ? MENU_PROGRESSION : CALM_PROGRESSION;
    const chord = prog[Math.floor(step / STEPS_PER_BAR) % prog.length];
    const bar = STEP_SEC * STEPS_PER_BAR;

    // Title theme on the menu only (the result screen keeps to pads and sparkle).
    if (this.musicMode === 'menu') {
      for (const [, midi, len] of themeNotesAt(step)) this.lead(ctx, midiToHz(midi), t, len * STEP_SEC);
    }

    if (inBar === 0) {
      this.pad(ctx, chord.pad, t, bar, I);
      // Sub drone on the root keeps the floor under everything.
      this.tone(ctx, {
        freq: midiToHz(chord.root),
        at: t,
        attack: 0.5,
        dur: bar + 0.4,
        peak: (calm ? 0.05 : 0.07) + I * 0.05,
        out: bus,
      });
      // Laptop speakers can't reproduce the sub, so give the root an audible upper octave and fifth.
      this.tone(ctx, { type: 'triangle', freq: midiToHz(chord.root + 12), at: t, attack: 0.6, dur: bar + 0.3, peak: calm ? 0.035 : 0.02, out: bus });
      this.tone(ctx, { freq: midiToHz(chord.root + 19), at: t, attack: 0.8, dur: bar, peak: calm ? 0.014 : 0.008, out: bus });
      if (this.danger) {
        // Thin minor-second whine — the Monolith's fans spinning up.
        [1174.7, 1244.5].forEach((f) =>
          this.tone(ctx, { freq: f, at: t, attack: 1.2, dur: bar, peak: 0.006, out: bus }),
        );
      }
    }

    // Calm scenes: sparse glassy sparkle on quarter notes.
    const themePass = this.musicMode === 'menu' && step % MENU_CYCLE_STEPS < STEPS_PER_BAR * 8;
    if (calm && inBar % 4 === 0 && Math.random() < (themePass ? 0.2 : 0.45)) {
      const note = pick(chord.pad) + pick([12, 24, 19]);
      const s = this.strip(ctx, bus, { pan: rand(-0.6, 0.6) }, 2, 0.8);
      this.tone(ctx, { type: 'triangle', freq: midiToHz(note), at: t, attack: 0.01, dur: 1.4, peak: 0.022, out: s.input });
    }

    // Bass pulse: 8ths, doubling to 16ths when it's tight.
    const bassLv = calm ? 0 : layerLevel(I, 0.25);
    const sixteenths = I > 0.72;
    if (bassLv > 0 && (sixteenths || inBar % 2 === 0)) {
      const accent = inBar % 4 === 0 ? 1 : 0.65;
      this.pluck(ctx, midiToHz(chord.root + 12), t, 0.18, 0.09 * bassLv * accent, 260 + I * 900, bus, 'sawtooth');
    }

    // Arp: the "Devin is thinking" ladder — chord tones climbing in 16ths.
    const arpLv = calm ? 0 : layerLevel(I, 0.45);
    if (arpLv > 0) {
      const ladder = [0, 1, 2, 1, 0, 2, 1, 2];
      const note = chord.pad[ladder[inBar % ladder.length]] + 12 + (inBar >= 8 && I > 0.8 ? 12 : 0);
      if (inBar % (I > 0.6 ? 1 : 2) === 0) {
        const s = this.strip(ctx, bus, { pan: inBar % 2 ? 0.35 : -0.35 }, 1, 0.35);
        this.pluck(ctx, midiToHz(note), t, 0.12, 0.03 * arpLv, 2600, s.input, 'square');
      }
    }

    // Hats: offbeat 8ths, then 16ths.
    const hatLv = calm ? 0 : layerLevel(I, 0.35);
    if (hatLv > 0 && (inBar % 4 === 2 || (I > 0.75 && inBar % 2 === 1))) {
      this.burst(ctx, {
        at: t,
        dur: inBar % 4 === 2 ? 0.07 : 0.03,
        peak: 0.022 * hatLv,
        out: bus,
        filter: 'bandpass',
        freq: 6800,
        q: 0.7,
      });
    }

    // Kick: half-time heartbeat, four-on-the-floor near the end.
    const kickLv = calm ? 0 : layerLevel(I, 0.55);
    if (kickLv > 0 && (inBar === 0 || inBar === 8 || (I > 0.82 && inBar % 4 === 0))) {
      this.tone(ctx, { freq: 130, to: 42, glide: 0.12, at: t, attack: 0.002, dur: 0.3, peak: 0.32 * kickLv, out: bus });
    }

    // War drums: taiko pickups into the next bar.
    const drumLv = calm ? 0 : layerLevel(I, 0.82, 0.1);
    if (drumLv > 0 && (inBar === 13 || inBar === 14 || inBar === 15)) {
      this.tone(ctx, { freq: 96, to: 62, at: t, attack: 0.002, dur: 0.35, peak: 0.16 * drumLv, out: bus });
      this.burst(ctx, { at: t, dur: 0.12, peak: 0.05 * drumLv, out: bus, filter: 'lowpass', freq: 700 });
    }
  }

  private pad(ctx: Ctx, notes: number[], t: number, bar: number, I: number) {
    const bus = this.musicBus!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const open = this.musicMode === 'battle' ? 0 : 480;
    lp.frequency.setValueAtTime(420 + open + I * 1700, t);
    lp.frequency.linearRampToValueAtTime(620 + open + I * 2100, t + bar * 0.6);
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    const peak = 0.05 + I * 0.025;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.9);
    g.gain.setValueAtTime(peak, t + bar - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 1.1);
    lp.connect(g).connect(bus);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    g.connect(send).connect(this.musicVerb!);
    const end = t + bar + 1.2;
    notes.forEach((n, i) => {
      [-7, 7].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToHz(n);
        o.detune.value = cents + (i - 1) * 2;
        const p = ctx.createStereoPanner();
        p.pan.value = cents < 0 ? -0.45 : 0.45;
        o.connect(p).connect(lp);
        o.start(t);
        o.stop(end);
        o.onended = () => p.disconnect();
      });
    });
    this.later(() => {
      lp.disconnect();
      g.disconnect();
      send.disconnect();
    }, (end - ctx.currentTime + 4) * 1000);
  }

  /** Soft lead for the title theme: triangle + sine octave, delayed vibrato, long hall send. */
  private lead(ctx: Ctx, freq: number, t: number, len: number) {
    const s = this.strip(ctx, this.musicBus!, { pan: 0.08 }, len + 2, 0.75);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(s.input);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibD = ctx.createGain();
    vibD.gain.setValueAtTime(0, t);
    vibD.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(0.6, len * 0.7));
    vib.connect(vibD);
    const dur = len * 0.92;
    const a = this.tone(ctx, { type: 'triangle', freq, at: t, attack: 0.06, dur, peak: 0.07, out: lp });
    const b = this.tone(ctx, { freq: freq * 2, at: t, attack: 0.08, dur: dur * 0.8, peak: 0.012, out: lp });
    vibD.connect(a.frequency);
    vibD.connect(b.frequency);
    vib.start(t);
    vib.stop(t + dur + 0.2);
    this.later(() => lp.disconnect(), (len + 3) * 1000);
  }

  private pluck(
    ctx: Ctx,
    freq: number,
    t: number,
    dur: number,
    peak: number,
    cutoff: number,
    out: AudioNode,
    type: OscillatorType,
  ) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 2.2, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.4), t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.004, peak, dur);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => {
      lp.disconnect();
      g.disconnect();
    };
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  click() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastUi < 0.03) return;
    this.lastUi = t;
    const bus = this.uiBus!;
    this.burst(ctx, { at: t, dur: 0.012, peak: 0.12, out: bus, filter: 'highpass', freq: 3800 });
    this.tone(ctx, { freq: 1900, to: 1250, at: t, attack: 0.002, dur: 0.045, peak: 0.07, out: bus });
    this.tone(ctx, { freq: 420, to: 300, at: t, attack: 0.002, dur: 0.07, peak: 0.08, out: bus });
  }

  hover() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastHover < 0.07) return;
    this.lastHover = t;
    this.tone(ctx, { freq: 2600, to: 2900, at: t, attack: 0.003, dur: 0.03, peak: 0.018, out: this.uiBus! });
  }

  place() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const bus = this.uiBus!;
    // Magnetic dock clamp: servo whirr → heavy thunk → metallic ring.
    this.burst(ctx, { at: t, dur: 0.08, peak: 0.05, out: bus, filter: 'bandpass', freq: 900, to: 2200, q: 3 });
    this.tone(ctx, { freq: 150, to: 62, at: t + 0.05, attack: 0.002, dur: 0.22, peak: 0.32, out: bus });
    this.burst(ctx, { at: t + 0.05, dur: 0.1, peak: 0.12, out: bus, filter: 'lowpass', freq: 1400 });
    const s = this.strip(ctx, bus, {}, 1, 0.5);
    this.tone(ctx, { type: 'triangle', freq: 523, at: t + 0.05, attack: 0.002, dur: 0.35, peak: 0.04, out: s.input });
    this.tone(ctx, { type: 'sine', freq: 1311, at: t + 0.05, attack: 0.002, dur: 0.25, peak: 0.025, out: s.input });
  }

  rotate() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const bus = this.uiBus!;
    const f = this.burst(ctx, { at: t, dur: 0.16, peak: 0.06, out: bus, filter: 'bandpass', freq: 600, to: 1500, q: 5 });
    void f;
    this.tone(ctx, { type: 'triangle', freq: 330, to: 495, at: t, attack: 0.01, dur: 0.14, peak: 0.07, out: bus });
    this.tone(ctx, { freq: 990, at: t + 0.13, attack: 0.002, dur: 0.05, peak: 0.04, out: bus });
  }

  error() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(this.uiBus!);
    this.tone(ctx, { type: 'square', freq: 196, at: t, attack: 0.003, dur: 0.08, peak: 0.06, out: lp });
    this.tone(ctx, { type: 'square', freq: 147, at: t + 0.1, attack: 0.003, dur: 0.12, peak: 0.06, out: lp });
    this.later(() => lp.disconnect(), 1500);
  }

  // ---------------------------------------------------------------------------
  // Battle SFX (spatial: `side` = which board, `pan` from the column)
  // ---------------------------------------------------------------------------

  sonarPulse(place: Place = { far: 1 }) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = this.strip(ctx, this.sfxBus!, place, 3, 0.6);
    this.tone(ctx, { freq: 1240, to: 1180, at: t, attack: 0.004, dur: 0.9, peak: 0.12, out: s.input });
    this.tone(ctx, { freq: 2480, at: t, attack: 0.004, dur: 0.25, peak: 0.02, out: s.input });
    // Return echo off the target.
    this.tone(ctx, { freq: 1180, at: t + 0.38, attack: 0.01, dur: 0.6, peak: 0.035, out: s.input });
    this.burst(ctx, { at: t, dur: 0.02, peak: 0.05, out: s.input, filter: 'highpass', freq: 5000 });
  }

  /**
   * Missile launch + flight. `target` is the board being fired at, so we know
   * whether it screams away from us or whistles in towards us.
   */
  launch(target: AudioSide, pan = 0) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const T = MISSILE_FLIGHT_MS / 1000;
    const bus = this.sfxBus!;
    if (target === 'enemy') {
      // Our battery: close ignition crack, then a roar that recedes over the water.
      const near = this.strip(ctx, bus, { pan: -pan * 0.6 }, 1.5, 0.2);
      this.burst(ctx, { at: t, dur: 0.09, peak: 0.42, out: near.input, filter: 'highpass', freq: 1400 });
      this.tone(ctx, { freq: 120, to: 44, at: t, attack: 0.002, dur: 0.32, peak: 0.42, out: near.input });
      const fly = this.strip(ctx, bus, { pan: -pan * 0.6 }, T + 1, 0.35);
      const flyPan = fly.nodes[2] as StereoPannerNode;
      flyPan.pan.linearRampToValueAtTime(pan, t + T);
      const roar = this.burst(ctx, { at: t, attack: 0.02, dur: T, peak: 0.22, out: fly.input, filter: 'bandpass', freq: 500, to: 1700, q: 1.3 });
      void roar;
      (fly.nodes[1] as BiquadFilterNode).frequency.setValueAtTime(16000, t);
      (fly.nodes[1] as BiquadFilterNode).frequency.exponentialRampToValueAtTime(3200, t + T);
      this.tone(ctx, { freq: 2300, to: 1250, at: t + 0.05, attack: 0.1, dur: T - 0.15, peak: 0.022, out: fly.input });
    } else {
      // The Monolith's battery: muffled distant thud, then a whistle growing louder overhead.
      const far = this.strip(ctx, bus, { pan: 0, far: 1 }, 2, 0.6);
      this.tone(ctx, { freq: 90, to: 38, at: t, attack: 0.003, dur: 0.5, peak: 0.3, out: far.input });
      this.burst(ctx, { at: t, dur: 0.25, peak: 0.14, out: far.input, filter: 'lowpass', freq: 600, brown: true });
      const inc = this.strip(ctx, bus, { pan: 0, far: 0.7 }, T + 1, 0.25);
      (inc.nodes[2] as StereoPannerNode).pan.linearRampToValueAtTime(pan, t + T);
      (inc.nodes[1] as BiquadFilterNode).frequency.setValueAtTime(5000, t);
      (inc.nodes[1] as BiquadFilterNode).frequency.exponentialRampToValueAtTime(16000, t + T);
      const w = ctx.createOscillator();
      w.frequency.setValueAtTime(1850, t);
      w.frequency.exponentialRampToValueAtTime(560, t + T);
      const vib = ctx.createOscillator();
      vib.frequency.value = 9;
      const vibD = ctx.createGain();
      vibD.gain.value = 14;
      vib.connect(vibD).connect(w.frequency);
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.004, t);
      wg.gain.exponentialRampToValueAtTime(0.11, t + T - 0.04);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + T + 0.02);
      w.connect(wg).connect(inc.input);
      w.start(t);
      vib.start(t);
      w.stop(t + T + 0.05);
      vib.stop(t + T + 0.05);
      this.burst(ctx, { at: t, attack: T * 0.8, dur: T * 0.2, peak: 0.12, out: inc.input, filter: 'bandpass', freq: 900, to: 2600, q: 1.5 });
    }
  }

  explosion(side: AudioSide, pan = 0, scale = 1) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const near = side === 'player';
    const k = scale * (near ? 1 : 0.8);
    const s = this.strip(ctx, this.sfxBus!, { pan, far: near ? 0 : 0.75 }, 2.5, near ? 0.3 : 0.45);
    // Transient crack
    this.burst(ctx, { at: t, dur: 0.05, peak: 0.55 * k, out: s.input, filter: 'highpass', freq: 2200 });
    // Sub boom
    this.tone(ctx, { freq: 92, to: 28, glide: 0.9, at: t, attack: 0.002, dur: 1.2, peak: 0.75 * k, out: s.input });
    this.tone(ctx, { type: 'triangle', freq: 58, to: 30, at: t, attack: 0.002, dur: 0.6, peak: 0.25 * k, out: s.input });
    // Saturated fireball body
    const ws = this.saturate(ctx, s.input);
    this.burst(ctx, { at: t, attack: 0.006, dur: 1.1, peak: 0.5 * k, out: ws, filter: 'lowpass', freq: 2600, to: 160, q: 0.8 });
    this.burst(ctx, { at: t + 0.04, attack: 0.05, dur: 1.6, peak: 0.25 * k, out: s.input, filter: 'lowpass', freq: 400, to: 90, brown: true });
    this.later(() => ws.disconnect(), 4000);
    // Debris crackle
    for (let i = 0; i < 14; i++) {
      this.burst(ctx, {
        at: t + 0.06 + Math.pow(Math.random(), 1.6) * 0.9,
        dur: rand(0.01, 0.04),
        peak: rand(0.02, 0.08) * k,
        out: s.input,
        filter: 'bandpass',
        freq: rand(1400, 4800),
        q: 2,
      });
    }
    this.duck(0.6, 0.15, 0.9);
    this.musicBump = Math.min(0.25, this.musicBump + 0.12);
  }

  splash(side: AudioSide, pan = 0, big = true) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const near = side === 'player';
    const k = (big ? 1 : 0.75) * (near ? 1 : 0.8);
    const s = this.strip(ctx, this.sfxBus!, { pan, far: near ? 0 : 0.7 }, 2, 0.35);
    this.burst(ctx, { at: t, attack: 0.006, dur: 0.55, peak: 0.34 * k, out: s.input, filter: 'lowpass', freq: 3600, to: 380, q: 1.2 });
    this.tone(ctx, { freq: 190, to: 58, at: t, attack: 0.003, dur: 0.3, peak: 0.2 * k, out: s.input });
    this.burst(ctx, { at: t + 0.03, attack: 0.06, dur: 1.1, peak: 0.06 * k, out: s.input, filter: 'highpass', freq: 4200 });
    this.bubbles(ctx, s.input, t + 0.12, big ? 10 : 6, 0.9, 0.035 * k);
    this.duck(0.25, 0.05, 0.4);
  }

  sink(side: AudioSide, pan = 0) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const near = side === 'player';
    const s = this.strip(ctx, this.sfxBus!, { pan, far: near ? 0 : 0.6 }, 4.5, 0.5);
    // Secondary magazine blast
    this.tone(ctx, { freq: 70, to: 24, at: t, attack: 0.004, dur: 1.8, peak: 0.6, out: s.input });
    this.burst(ctx, { at: t, attack: 0.01, dur: 2.6, peak: 0.34, out: s.input, filter: 'lowpass', freq: 520, to: 70, brown: true });
    // Hull groan: detuned saws through a falling formant with a slow wobble
    const form = ctx.createBiquadFilter();
    form.type = 'bandpass';
    form.Q.value = 5;
    form.frequency.setValueAtTime(560, t + 0.3);
    form.frequency.exponentialRampToValueAtTime(130, t + 3.4);
    form.connect(s.input);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5;
    const lfoD = ctx.createGain();
    lfoD.gain.value = 3;
    lfo.connect(lfoD);
    [62, 64.5].forEach((f) => {
      const o = this.tone(ctx, { type: 'sawtooth', freq: f, to: 36, glide: 3, at: t + 0.3, attack: 0.6, dur: 2.8, peak: 0.16, out: form });
      lfoD.connect(o.frequency);
    });
    lfo.start(t + 0.3);
    lfo.stop(t + 3.8);
    this.later(() => form.disconnect(), 6000);
    // Metal creaks
    for (let i = 0; i < 3; i++) {
      const at = t + rand(0.6, 2.4);
      const f = rand(180, 320);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 3;
      bp.Q.value = 8;
      bp.connect(s.input);
      this.tone(ctx, { type: 'square', freq: f, to: f * rand(0.6, 0.8), at, attack: 0.04, dur: rand(0.2, 0.4), peak: 0.07, out: bp });
      this.later(() => bp.disconnect(), 5000);
    }
    this.bubbles(ctx, s.input, t + 0.4, 26, 3, 0.04);
    this.duck(0.65, 0.6, 1.8);
    this.musicBump = Math.min(0.3, this.musicBump + 0.2);
  }

  // ---------------------------------------------------------------------------
  // Legacy Monolith (boss) stingers
  // ---------------------------------------------------------------------------

  /** Detuned low brass with an opening filter — the Monolith's voice. */
  private brass(ctx: Ctx, out: AudioNode, at: number, freq: number, dur: number, peak: number, bright = 1400) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(140, at);
    lp.frequency.exponentialRampToValueAtTime(bright, at + Math.min(0.12, dur * 0.3));
    lp.frequency.exponentialRampToValueAtTime(180, at + dur);
    lp.connect(out);
    [1, 1.006, 0.5, 1.498].forEach((m, i) =>
      this.tone(ctx, { type: 'sawtooth', freq: freq * m, at, attack: 0.04, dur, peak: peak * (i === 3 ? 0.35 : 1), out: lp }),
    );
    this.later(() => lp.disconnect(), (dur + 2) * 1000);
  }

  /** Mainframe punch-card chatter: quantised square bleeps. */
  private chatter(ctx: Ctx, out: AudioNode, at: number, n: number, peak = 0.028) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 1.2;
    bp.connect(out);
    const notes = [659, 784, 880, 1047, 1175, 1319];
    for (let i = 0; i < n; i++) {
      this.tone(ctx, { type: 'square', freq: pick(notes), at: at + i * 0.055, attack: 0.002, dur: 0.035, peak, out: bp });
    }
    this.later(() => bp.disconnect(), (n * 0.055 + 2) * 1000);
  }

  private bossStrip(ctx: Ctx, life: number) {
    return this.strip(ctx, this.sfxBus!, { pan: 0, far: 0.85 }, life, 0.7);
  }

  /** The Monolith powers up as the battle begins. */
  bossEntrance() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const s = this.bossStrip(ctx, 5);
    this.burst(ctx, { at: t, attack: 1.1, dur: 0.15, peak: 0.12, out: s.input, filter: 'bandpass', freq: 220, to: 3200, q: 2 });
    this.tone(ctx, { type: 'sawtooth', freq: 55, to: 220, glide: 1.2, at: t, attack: 1.1, dur: 0.12, peak: 0.05, out: s.input });
    const hit = t + 1.25;
    this.tone(ctx, { freq: 52, to: 24, at: hit, attack: 0.003, dur: 2.6, peak: 0.7, out: s.input });
    this.burst(ctx, { at: hit, attack: 0.005, dur: 1.6, peak: 0.3, out: s.input, filter: 'lowpass', freq: 900, to: 80, brown: true });
    this.brass(ctx, s.input, hit, midiToHz(38), 2.4, 0.06, 1100); // D2
    this.brass(ctx, s.input, hit, midiToHz(39), 2.4, 0.045, 900); // Eb2 — wrong on purpose
    this.chatter(ctx, s.input, hit + 0.5, 14);
    this.duck(0.7, 1.4, 2);
  }

  /**
   * One 8-bit "syllable" of the Monolith's voice: a square wave doing a
   * chiptune arpeggio flutter while its pitch glides from f0 to f1.
   */
  private syllable(ctx: Ctx, out: AudioNode, at: number, f0: number, f1: number, dur: number, peak: number, flutter = 1.25) {
    const o = ctx.createOscillator();
    o.type = 'square';
    const steps = Math.max(2, Math.round(dur / 0.026));
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const f = f0 * Math.pow(f1 / f0, k) * (i % 2 ? flutter : 1);
      o.frequency.setValueAtTime(f, at + k * dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.setValueAtTime(peak, at + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.03);
    o.onended = () => g.disconnect();
  }

  /** Crushed, "a"-vowel formant chain for the Monolith's voice. Auto-disconnects. */
  private voiceChain(ctx: Ctx, out: AudioNode, life: number, formant = 1100): AudioNode {
    const crush = ctx.createWaveShaper();
    crush.curve = this.crusher;
    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = formant;
    bp.Q.value = 1.4;
    bp.gain.value = 9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    crush.connect(bp).connect(lp).connect(out);
    this.later(() => [crush, bp, lp].forEach((n) => n.disconnect()), (life + 2) * 1000);
    return crush;
  }

  /** "Ticket closed" chime — our side scores. Close and bright. */
  private ticketClosed(ctx: Ctx, at: number) {
    const c = this.strip(ctx, this.sfxBus!, {}, 3, 0.6);
    [
      [1318.5, 0.05],
      [1975.5, 0.03],
      [2637, 0.012],
    ].forEach(([f, p]) => this.tone(ctx, { freq: f, at, attack: 0.003, dur: 1.6, peak: p, out: c.input }));
    this.tone(ctx, { freq: 1760, at: at + 0.12, attack: 0.003, dur: 1.4, peak: 0.035, out: c.input });
  }

  /**
   * The Legacy Monolith's voice, driven by its on-screen mood (fx 'bossMood').
   * Each mood has a cooldown so rapid mood flips never machine-gun the voice.
   */
  bossVoice(mood: BossMood) {
    const ctx = this.live();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - (this.lastMood[mood] ?? -99) < MOOD_COOLDOWN[mood]) return;
    this.lastMood[mood] = now;
    const t = now + 0.03;
    switch (mood) {
      case 'laugh': {
        // Glitchy 8-bit "HA-HA-HA-HA" that stutters on one syllable like a bad tape read.
        const s = this.bossStrip(ctx, 2.5);
        const v = this.voiceChain(ctx, s.input, 2.5);
        const notes = [330, 311, 294, 262];
        const glitch = Math.floor(rand(1, 3));
        let at = t;
        notes.forEach((f, i) => {
          this.syllable(ctx, v, at, f, f * 0.78, 0.12, 0.09);
          if (i === glitch) {
            at += 0.06;
            this.syllable(ctx, v, at, f * 1.5, f * 1.2, 0.04, 0.07, 1);
            this.syllable(ctx, v, at + 0.045, f * 1.5, f * 1.2, 0.04, 0.07, 1);
          }
          at += 0.15;
        });
        this.syllable(ctx, v, at + 0.02, 523, 1568, 0.06, 0.05, 1);
        this.chatter(ctx, s.input, at + 0.1, 5, 0.016);
        break;
      }
      case 'gloat': {
        // Lower, slower "heh… heh" with a smug brass tail.
        const s = this.bossStrip(ctx, 2.5);
        const v = this.voiceChain(ctx, s.input, 2.5, 800);
        this.syllable(ctx, v, t, 220, 180, 0.13, 0.09, 1.19);
        this.syllable(ctx, v, t + 0.22, 208, 165, 0.2, 0.08, 1.19);
        this.brass(ctx, s.input, t + 0.05, midiToHz(38), 0.5, 0.035, 1200);
        this.chatter(ctx, s.input, t + 0.5, 6, 0.016);
        break;
      }
      case 'smug': {
        // A quiet, self-satisfied "hm-hmm".
        const s = this.bossStrip(ctx, 1.5);
        const v = this.voiceChain(ctx, s.input, 1.5, 700);
        this.syllable(ctx, v, t, 175, 196, 0.1, 0.035, 1);
        this.syllable(ctx, v, t + 0.14, 196, 156, 0.22, 0.035, 1);
        break;
      }
      case 'hurt': {
        // Digital crunch: crushed noise hit, a falling "ow", a few dropped frames.
        const s = this.bossStrip(ctx, 2);
        const v = this.voiceChain(ctx, s.input, 2, 1400);
        this.burst(ctx, { at: t, dur: 0.1, peak: 0.16, out: v, filter: 'bandpass', freq: 1500, q: 0.9 });
        const ws = this.saturate(ctx, s.input);
        this.tone(ctx, { type: 'sawtooth', freq: 118, to: 46, at: t, attack: 0.004, dur: 0.45, peak: 0.12, out: ws });
        this.syllable(ctx, v, t + 0.05, 392, 147, 0.26, 0.07, 1.33);
        for (let i = 0; i < 6; i++) {
          this.tone(ctx, { type: 'square', freq: rand(160, 900), at: t + 0.12 + i * 0.03, attack: 0.001, dur: 0.016, peak: 0.022, out: v });
        }
        this.later(() => ws.disconnect(), 3000);
        break;
      }
      case 'rage': {
        // SEV-1 klaxon: alternating siren through the crusher, over a dissonant brass stab.
        const s = this.bossStrip(ctx, 3);
        const v = this.voiceChain(ctx, s.input, 3, 1500);
        for (let i = 0; i < 6; i++) {
          const f = i % 2 ? 554 : 740;
          this.syllable(ctx, v, t + i * 0.17, f, f * 0.97, 0.16, 0.06, 1.003);
        }
        this.brass(ctx, s.input, t, midiToHz(38), 0.9, 0.045, 1600);
        this.brass(ctx, s.input, t, midiToHz(39), 0.9, 0.035, 1300);
        this.tone(ctx, { freq: 60, to: 34, at: t, attack: 0.004, dur: 0.8, peak: 0.25, out: s.input });
        this.ticketClosed(ctx, t + 1.05);
        break;
      }
      case 'charge': {
        // Capacitor whine as it lines up a shot at us.
        const s = this.bossStrip(ctx, 1.5);
        const v = this.voiceChain(ctx, s.input, 1.5, 1800);
        this.tone(ctx, { type: 'sawtooth', freq: 160, to: 1150, glide: 0.55, at: t, attack: 0.4, dur: 0.18, peak: 0.022, out: v });
        this.chatter(ctx, s.input, t + 0.1, 4, 0.012);
        break;
      }
      case 'dead': {
        // Power-down: the whole cabinet's whine winds down, drives click, CRT thunks off.
        const s = this.bossStrip(ctx, 5);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5000, t);
        lp.frequency.exponentialRampToValueAtTime(160, t + 2.4);
        lp.connect(s.input);
        const v = this.voiceChain(ctx, lp, 5, 900);
        [
          ['sawtooth', 880, 0.05],
          ['square', 1318, 0.025],
        ].forEach(([type, f, p]) => {
          const o = ctx.createOscillator();
          o.type = type as OscillatorType;
          o.frequency.setValueAtTime(f as number, t);
          o.frequency.exponentialRampToValueAtTime(28, t + 2.4);
          const g = ctx.createGain();
          g.gain.setValueAtTime(p as number, t);
          g.gain.setValueAtTime(p as number, t + 1.6);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
          o.connect(g).connect(v);
          o.start(t);
          o.stop(t + 2.6);
          o.onended = () => g.disconnect();
        });
        for (let i = 0; i < 7; i++) {
          this.burst(ctx, { at: t + 0.2 + i * 0.17 * (1 + i * 0.12), dur: 0.012, peak: 0.07, out: s.input, filter: 'bandpass', freq: 2600, q: 3 });
        }
        const off = t + 2.45;
        this.tone(ctx, { freq: 70, to: 30, at: off, attack: 0.002, dur: 0.5, peak: 0.35, out: s.input });
        this.burst(ctx, { at: off, dur: 0.03, peak: 0.12, out: s.input, filter: 'highpass', freq: 3000 });
        this.tone(ctx, { freq: 15600, at: off - 0.6, attack: 0.1, dur: 0.5, peak: 0.004, out: s.input });
        this.later(() => lp.disconnect(), 7000);
        break;
      }
      case 'victory': {
        // Smug "nyah-nyah" jingle in 8-bit, then a last chuckle.
        const s = this.bossStrip(ctx, 4);
        const v = this.voiceChain(ctx, s.input, 4, 1200);
        const tune: [number, number][] = [
          [67, 0.2],
          [64, 0.2],
          [69, 0.14],
          [67, 0.2],
          [64, 0.45],
        ];
        let at = t;
        tune.forEach(([m, d]) => {
          const f = midiToHz(m);
          this.syllable(ctx, v, at, f, f * 0.99, d * 0.92, 0.07, 1.005);
          at += d;
        });
        this.brass(ctx, s.input, t, midiToHz(38), at - t, 0.03, 1000);
        [330, 294, 262].forEach((f, i) => this.syllable(ctx, v, at + 0.15 + i * 0.14, f, f * 0.78, 0.11, 0.07));
        break;
      }
    }
  }

  /** Down to the last ship — `who` is the side with one hull left. */
  lastStand(who: AudioSide) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.9;
    if (who === 'player') {
      const s = this.strip(ctx, this.sfxBus!, {}, 3, 0.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.connect(s.input);
      for (let i = 0; i < 4; i++) {
        this.tone(ctx, { type: 'square', freq: i % 2 ? 554 : 659, at: t + i * 0.22, attack: 0.01, dur: 0.18, peak: 0.045, out: lp });
      }
      this.later(() => lp.disconnect(), 4000);
    } else {
      const s = this.strip(ctx, this.sfxBus!, {}, 3, 0.5);
      this.brass(ctx, s.input, t, midiToHz(50), 0.5, 0.04, 2600);
      this.brass(ctx, s.input, t + 0.32, midiToHz(57), 1.2, 0.045, 3000);
      this.tone(ctx, { freq: 110, to: 70, at: t + 0.32, attack: 0.002, dur: 0.5, peak: 0.25, out: s.input });
    }
    this.musicBump = Math.min(0.35, this.musicBump + 0.2);
  }

  // ---------------------------------------------------------------------------
  // Result stingers
  // ---------------------------------------------------------------------------

  /** Match decided: the score drops out so the boss's last words land. Result stings follow on the result screen. */
  victory() {
    this.setMusicMode('over');
    const ctx = this.liveMusic();
    if (!ctx) return;
    const t = ctx.currentTime + 0.1;
    const s = this.strip(ctx, this.stingBus!, {}, 4, 0.5);
    this.tone(ctx, { freq: 73.4, to: 36, at: t, attack: 0.003, dur: 1.6, peak: 0.3, out: s.input });
    this.duck(1, 2, 1);
  }

  defeat() {
    this.setMusicMode('over');
    const ctx = this.liveMusic();
    if (!ctx) return;
    const t = ctx.currentTime + 0.1;
    const s = this.strip(ctx, this.stingBus!, {}, 4, 0.5);
    this.tone(ctx, { freq: 55, to: 30, at: t, attack: 0.003, dur: 1.8, peak: 0.3, out: s.input });
    this.duck(1, 2, 1);
  }

  /** Bell with inharmonic partials — the "merged" bell. */
  private bell(ctx: Ctx, out: AudioNode, at: number, freq: number, peak: number, dur = 2.2) {
    [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.18],
      [8.93, 0.06],
    ].forEach(([m, p]) => this.tone(ctx, { freq: freq * m, at, attack: 0.002, dur: dur / Math.sqrt(m), peak: peak * p, out }));
  }

  /** Result screen sting. Win = "PR merged" fanfare, loss = "build failed" sad brass. */
  resultSting(win: boolean) {
    const ctx = this.liveMusic();
    if (!ctx) return;
    const t = ctx.currentTime + 0.12;
    this.duck(1, 4, 2);
    if (win) {
      const s = this.strip(ctx, this.stingBus!, {}, 7, 0.55);
      // da-da-da DAAA: triplet pickup on A, landing on a big D major.
      [0, 0.11, 0.22].forEach((d) => this.brass(ctx, s.input, t + d, midiToHz(57), 0.1, 0.03, 2600));
      this.tone(ctx, { freq: 73.4, to: 48, at: t, attack: 0.002, dur: 0.4, peak: 0.25, out: s.input });
      const hit = t + 0.36;
      [50, 57, 62, 66, 69, 74].forEach((m) => this.brass(ctx, s.input, hit, midiToHz(m), 2.6, 0.022, 3400));
      this.tone(ctx, { freq: 73.4, at: hit, attack: 0.01, dur: 2.6, peak: 0.24, out: s.input });
      [0, 0.12].forEach((d) => this.tone(ctx, { freq: 98, to: 55, at: hit + d, attack: 0.002, dur: 0.5, peak: 0.28, out: s.input }));
      // Rising "all checks green" arpeggio, then the merge bell.
      [74, 78, 81, 86, 90, 93].forEach((m, i) =>
        this.tone(ctx, { type: 'triangle', freq: midiToHz(m), at: hit + 0.25 + i * 0.075, attack: 0.004, dur: 1.2, peak: 0.026, out: s.input }),
      );
      this.bell(ctx, s.input, hit + 0.8, midiToHz(86), 0.05);
      this.bell(ctx, s.input, hit + 1.05, midiToHz(93), 0.035);
    } else {
      const s = this.strip(ctx, this.stingBus!, {}, 7, 0.5);
      // Sad "wah-wah-wah-waaah": each brass note sags and its filter opens and closes like a plunger mute.
      const notes: [number, number][] = [
        [52, 0.42],
        [51, 0.42],
        [50, 0.42],
        [49, 1.6],
      ];
      let at = t;
      notes.forEach(([m, d], i) => {
        const wah = ctx.createBiquadFilter();
        wah.type = 'lowpass';
        wah.Q.value = 6;
        wah.frequency.setValueAtTime(300, at);
        wah.frequency.linearRampToValueAtTime(1500, at + 0.14);
        wah.frequency.linearRampToValueAtTime(380, at + d * 0.9);
        wah.connect(s.input);
        const f = midiToHz(m);
        [1, 1.005].forEach((k) => {
          const o = this.tone(ctx, { type: 'sawtooth', freq: f * k, to: f * k * 0.985, at, attack: 0.04, dur: d * 0.92, peak: 0.075, out: wah });
          if (i === 3) {
            const vib = ctx.createOscillator();
            vib.frequency.value = 5.5;
            const vd = ctx.createGain();
            vd.gain.setValueAtTime(0, at);
            vd.gain.linearRampToValueAtTime(f * 0.03, at + 0.5);
            vib.connect(vd).connect(o.frequency);
            vib.start(at);
            vib.stop(at + d);
          }
        });
        this.later(() => wah.disconnect(), (at - ctx.currentTime + d + 2) * 1000);
        at += d;
      });
      this.tone(ctx, { freq: 41.2, to: 36, at: t + 1.26, attack: 0.1, dur: 1.6, peak: 0.2, out: s.input });
      // CI-red error buzzer and the Monolith's printer chattering out the incident report.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      lp.connect(s.input);
      [0, 0.2].forEach((d) => this.tone(ctx, { type: 'square', freq: 110, at: at + 0.1 + d, attack: 0.005, dur: 0.14, peak: 0.05, out: lp }));
      this.later(() => lp.disconnect(), 6000);
      this.chatter(ctx, s.input, at + 0.5, 16, 0.016);
    }
  }

  /**
   * Commander call signs on the select screen. `preview` is the quieter
   * version played on hover/focus; the full one plays on selection.
   */
  commanderMotif(id: CommanderId, preview = false) {
    const ctx = this.liveMusic();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (preview && now - this.lastMotif < 0.35) return;
    this.lastMotif = now;
    const t = now + 0.02;
    const k = preview ? 0.55 : 1;
    const s = this.strip(ctx, this.stingBus!, {}, 4, 0.5);
    this.duck(0.5, 1, 1);
    switch (id) {
      case 'scott-wu':
        // Competitive programmer: a fast, exact D-major run that lands on a clean high ping.
        [62, 66, 69, 74, 76, 78, 81].forEach((m, i) => {
          const f = midiToHz(m);
          this.tone(ctx, { freq: f, at: t + i * 0.055, attack: 0.002, dur: i === 6 ? 1.1 : 0.16, peak: 0.05 * k, out: s.input });
          this.tone(ctx, { type: 'triangle', freq: f * 2, at: t + i * 0.055, attack: 0.002, dur: 0.06, peak: 0.012 * k, out: s.input });
        });
        this.bell(ctx, s.input, t + 0.4, midiToHz(93), 0.02 * k, 1.2);
        break;
      case 'chris-degnan':
        // Closer: confident brass D-A-D, then the "deal closed" bell twice.
        [
          [50, 0, 0.14],
          [57, 0.15, 0.14],
          [62, 0.3, 0.8],
        ].forEach(([m, d, len]) => {
          this.brass(ctx, s.input, t + d, midiToHz(m), len, 0.04 * k, 2800);
          this.brass(ctx, s.input, t + d, midiToHz(m + 7), len, 0.018 * k, 2800);
        });
        this.bell(ctx, s.input, t + 0.55, midiToHz(96), 0.03 * k, 1.4);
        this.bell(ctx, s.input, t + 0.68, midiToHz(100), 0.025 * k, 1.4);
        break;
      case 'jeff-wang': {
        // Windsurf: a wave swell carrying a gliding surf lead, answered by a tremolo pluck.
        this.burst(ctx, { at: t, attack: 0.45, dur: 0.8, peak: 0.07 * k, out: s.input, filter: 'bandpass', freq: 400, to: 2200, q: 0.8 });
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        lp.connect(s.input);
        this.tone(ctx, { type: 'sawtooth', freq: midiToHz(69), to: midiToHz(76), glide: 0.3, at: t + 0.1, attack: 0.05, dur: 0.6, peak: 0.035 * k, out: lp });
        [76, 74, 71, 69].forEach((m, i) =>
          this.pluck(ctx, midiToHz(m), t + 0.72 + i * 0.09, 0.22, 0.05 * k, 1800, s.input, 'triangle'),
        );
        this.later(() => lp.disconnect(), 3000);
        break;
      }
      case 'will-mccarthy':
        // Leads the charge: snare roll into a bugle call.
        for (let i = 0; i < 10; i++) {
          this.burst(ctx, { at: t + i * 0.035, dur: 0.03, peak: (0.02 + i * 0.006) * k, out: s.input, filter: 'bandpass', freq: 2400, q: 0.8 });
        }
        [
          [67, 0.38, 0.1],
          [72, 0.5, 0.1],
          [76, 0.62, 0.1],
          [79, 0.76, 0.6],
        ].forEach(([m, d, len]) =>
          this.tone(ctx, { type: 'triangle', freq: midiToHz(m), at: t + d, attack: 0.012, dur: len, peak: 0.06 * k, out: s.input }),
        );
        this.tone(ctx, { freq: 98, to: 55, at: t + 0.38, attack: 0.002, dur: 0.3, peak: 0.2 * k, out: s.input });
        break;
    }
  }

  /** Konami code: an 8-bit "LGTM" fanfare. */
  easterEgg() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = this.strip(ctx, this.uiBus!, {}, 2, 0.3);
    [74, 78, 81, 86, 81, 86].forEach((m, i) =>
      this.tone(ctx, { type: 'square', freq: midiToHz(m), at: t + i * 0.09, attack: 0.002, dur: i === 5 ? 0.5 : 0.08, peak: 0.05, out: s.input }),
    );
  }

  // ---------------------------------------------------------------------------
  // Legacy entry points (kept so existing callers keep working)
  // ---------------------------------------------------------------------------

  fire() {
    this.launch('enemy');
  }
  miss() {
    this.splash('enemy');
  }
  hit() {
    this.explosion('enemy');
  }
}

export const audio = new AudioEngine();
