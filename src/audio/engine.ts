/**
 * Procedural Web Audio engine — every sound is synthesized, no asset files.
 *
 * Signal flow:
 *   ui / sfx / music(duck) / ambient buses ─┬─► glue compressor ─► brickwall limiter ─► master volume ─► out
 *                     reverb sends ─► convolver (generated hall IR) ─┘
 *
 * The adaptive score is a look-ahead step sequencer whose layers fade in as the
 * battle intensity rises (see ./music.ts for the pure maths).
 */
import { MISSILE_FLIGHT_MS } from '../state/fx';
import {
  CALM_PROGRESSION,
  DANGER_PROGRESSION,
  STEP_SEC,
  STEPS_PER_BAR,
  baseIntensity,
  clamp01,
  layerLevel,
  midiToHz,
} from './music';
import type { MusicMode } from './music';

export type AudioSide = 'player' | 'enemy';
export type { MusicMode } from './music';

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

const LOOKAHEAD_SEC = 0.3;
const SCHEDULER_MS = 40;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private outGain: GainNode | null = null;
  private mix: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private shaper: Float32Array<ArrayBuffer> | null = null;

  private ambientStarted = false;
  private _volume = 0.8;
  private _muted = false;
  private lastHover = 0;
  private lastUi = 0;

  // --- adaptive score state ---
  private musicMode: MusicMode = 'off';
  private musicTarget = 0;
  private musicLevel = 0;
  private musicBump = 0;
  private danger = false;
  private step = 0;
  private nextStepAt = 0;
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private musicResumeTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;

      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -20;
      glue.knee.value = 12;
      glue.ratio.value = 3.5;
      glue.attack.value = 0.006;
      glue.release.value = 0.28;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.12;

      this.outGain = ctx.createGain();
      this.outGain.gain.value = this.targetVolume();
      this.mix = ctx.createGain();
      this.mix.gain.value = 0.9;
      this.mix.connect(glue).connect(limiter).connect(this.outGain).connect(ctx.destination);

      const bus = (level: number, dest: AudioNode = this.mix!) => {
        const g = ctx.createGain();
        g.gain.value = level;
        g.connect(dest);
        return g;
      };
      this.sfxBus = bus(0.95);
      this.uiBus = bus(0.55);
      this.musicDuck = bus(1);
      this.musicBus = bus(0, this.musicDuck);
      this.ambientBus = bus(0.5);

      const verb = ctx.createConvolver();
      verb.buffer = this.hallImpulse(ctx, 3.2);
      const verbTone = ctx.createBiquadFilter();
      verbTone.type = 'lowpass';
      verbTone.frequency.value = 5200;
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 1;
      this.reverbIn.connect(verb).connect(verbTone).connect(bus(0.42));

      this.white = this.noiseBuffer(ctx, 2, false);
      this.brown = this.noiseBuffer(ctx, 4, true);
      this.shaper = this.saturationCurve(2.6);

      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
    return this.ctx;
  }

  private targetVolume() {
    // Perceptual taper so the slider feels even across its travel.
    return this._muted ? 0 : Math.pow(this._volume, 1.6);
  }

  setVolume(v: number) {
    this._volume = clamp01(v);
    if (this.outGain && this.ctx) this.outGain.gain.setTargetAtTime(this.targetVolume(), this.ctx.currentTime, 0.04);
  }

  setMuted(m: boolean) {
    this._muted = m;
    if (this.outGain && this.ctx) this.outGain.gain.setTargetAtTime(this.targetVolume(), this.ctx.currentTime, 0.04);
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

  /** Ready-to-play context, or null when muted / unavailable (saves CPU). */
  private live(): AudioContext | null {
    if (this.silent()) return null;
    return this.ensure();
  }

  private noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
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

  private hallImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
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
  private strip(ctx: AudioContext, bus: AudioNode, place: Place, life: number, send = 0.25): Strip {
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
    pan.connect(sendGain).connect(this.reverbIn!);
    const nodes = [input, air, pan, sendGain];
    setTimeout(() => nodes.forEach((n) => n.disconnect()), (life + 3.5) * 1000);
    return { input, nodes };
  }

  private env(param: AudioParam, at: number, attack: number, peak: number, dur: number) {
    param.cancelScheduledValues(at);
    param.setValueAtTime(0.0001, at);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + Math.max(attack, 0.001));
    param.exponentialRampToValueAtTime(0.0001, at + Math.max(attack, 0.001) + dur);
  }

  private tone(ctx: AudioContext, o: ToneOpts): OscillatorNode {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, o.at);
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

  private burst(ctx: AudioContext, o: BurstOpts): BiquadFilterNode {
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

  private saturate(ctx: AudioContext, out: AudioNode): WaveShaperNode {
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

  private bubbles(ctx: AudioContext, out: AudioNode, at: number, count: number, span: number, peak: number) {
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
    const ctx = this.ensure();
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
      setTimeout(loop, rand(9000, 15000));
    };
    setTimeout(loop, 4000);

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
    this.schedTimer = setInterval(() => this.schedule(), SCHEDULER_MS);
    if (this.musicMode === 'off') this.setMusicMode('menu');
    else this.applyMusicBus(1.2);
  }

  private applyMusicBus(fade: number) {
    if (!this.ctx || !this.musicBus) return;
    const level = this.musicMode === 'off' ? 0 : this.musicMode === 'over' ? 0.5 : 0.8;
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
    if (this.musicResumeTimer) clearTimeout(this.musicResumeTimer);
    if (!this.ctx || !this.musicBus) return;
    if (mode === 'over') {
      // Let the victory/defeat stinger ring alone, then return with a quiet outro bed.
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
      this.musicBus.gain.linearRampToValueAtTime(0, t + 0.35);
      this.musicResumeTimer = setTimeout(() => {
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
      if (this.musicMode !== 'off' && !this.silent()) this.playStep(ctx, this.step, this.nextStepAt);
      this.step = (this.step + 1) % (STEPS_PER_BAR * 4);
      this.nextStepAt += STEP_SEC;
    }
  }

  private playStep(ctx: AudioContext, step: number, t: number) {
    const bus = this.musicBus!;
    const I = this.musicLevel;
    const inBar = step % STEPS_PER_BAR;
    const prog = this.danger ? DANGER_PROGRESSION : CALM_PROGRESSION;
    const chord = prog[Math.floor(step / STEPS_PER_BAR) % prog.length];
    const bar = STEP_SEC * STEPS_PER_BAR;
    const calm = this.musicMode === 'menu' || this.musicMode === 'over';

    if (inBar === 0) {
      this.pad(ctx, chord.pad, t, bar, I);
      // Sub drone on the root keeps the floor under everything.
      this.tone(ctx, {
        freq: midiToHz(chord.root),
        at: t,
        attack: 0.5,
        dur: bar + 0.4,
        peak: 0.07 + I * 0.05,
        out: bus,
      });
      if (this.danger) {
        // Thin minor-second whine — the Monolith's fans spinning up.
        [1174.7, 1244.5].forEach((f) =>
          this.tone(ctx, { freq: f, at: t, attack: 1.2, dur: bar, peak: 0.006, out: bus }),
        );
      }
    }

    // Calm scenes: sparse glassy sparkle on quarter notes.
    if (calm && inBar % 4 === 0 && Math.random() < 0.45) {
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
        peak: 0.03 * hatLv,
        out: bus,
        filter: 'highpass',
        freq: 7200,
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

  private pad(ctx: AudioContext, notes: number[], t: number, bar: number, I: number) {
    const bus = this.musicBus!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420 + I * 1700, t);
    lp.frequency.linearRampToValueAtTime(620 + I * 2100, t + bar * 0.6);
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
    g.connect(send).connect(this.reverbIn!);
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
    setTimeout(() => {
      lp.disconnect();
      g.disconnect();
      send.disconnect();
    }, (end - ctx.currentTime + 4) * 1000);
  }

  private pluck(
    ctx: AudioContext,
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
    setTimeout(() => lp.disconnect(), 1500);
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
    setTimeout(() => ws.disconnect(), 4000);
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
    setTimeout(() => form.disconnect(), 6000);
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
      setTimeout(() => bp.disconnect(), 5000);
    }
    this.bubbles(ctx, s.input, t + 0.4, 26, 3, 0.04);
    this.duck(0.65, 0.6, 1.8);
    this.musicBump = Math.min(0.3, this.musicBump + 0.2);
  }

  // ---------------------------------------------------------------------------
  // Legacy Monolith (boss) stingers
  // ---------------------------------------------------------------------------

  /** Detuned low brass with an opening filter — the Monolith's voice. */
  private brass(ctx: AudioContext, out: AudioNode, at: number, freq: number, dur: number, peak: number, bright = 1400) {
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
    setTimeout(() => lp.disconnect(), (dur + 2) * 1000);
  }

  /** Mainframe punch-card chatter: quantised square bleeps. */
  private chatter(ctx: AudioContext, out: AudioNode, at: number, n: number, peak = 0.028) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 1.2;
    bp.connect(out);
    const notes = [659, 784, 880, 1047, 1175, 1319];
    for (let i = 0; i < n; i++) {
      this.tone(ctx, { type: 'square', freq: pick(notes), at: at + i * 0.055, attack: 0.002, dur: 0.035, peak, out: bp });
    }
    setTimeout(() => bp.disconnect(), (n * 0.055 + 2) * 1000);
  }

  private bossStrip(ctx: AudioContext, life: number) {
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

  /** Monolith lands a hit on our fleet. */
  bossTaunt() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.25;
    const s = this.bossStrip(ctx, 2);
    this.brass(ctx, s.input, t, midiToHz(38), 0.45, 0.05);
    this.chatter(ctx, s.input, t + 0.15, 6, 0.02);
  }

  /** Monolith sinks one of ours: a three-pulse brass "ha-ha-ha". */
  bossLaugh() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.5;
    const s = this.bossStrip(ctx, 3);
    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = 720;
    formant.Q.value = 2;
    formant.gain.value = 10;
    formant.connect(s.input);
    [38, 37, 36].forEach((m, i) => this.brass(ctx, formant, t + i * 0.27, midiToHz(m), 0.24, 0.07, 1800));
    this.chatter(ctx, s.input, t + 0.9, 10, 0.022);
    setTimeout(() => formant.disconnect(), 5000);
  }

  /** We sink one of theirs: the Monolith glitches and groans; we get a clean chime. */
  bossHurt() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.35;
    const s = this.bossStrip(ctx, 3);
    const ws = this.saturate(ctx, s.input);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 1.4;
    bp.connect(ws);
    this.tone(ctx, { type: 'sawtooth', freq: 118, to: 42, at: t, attack: 0.03, dur: 1, peak: 0.22, out: bp });
    this.tone(ctx, { type: 'sawtooth', freq: 124, to: 40, at: t, attack: 0.03, dur: 1, peak: 0.18, out: bp });
    // Glitch stutter — a crashing mainframe
    for (let i = 0; i < 10; i++) {
      this.tone(ctx, { type: 'square', freq: rand(160, 900), at: t + 0.1 + i * 0.035, attack: 0.001, dur: 0.018, peak: 0.03, out: s.input });
    }
    setTimeout(() => {
      ws.disconnect();
      bp.disconnect();
    }, 4000);
    // "Ticket closed" chime for our side, close and bright.
    const c = this.strip(ctx, this.sfxBus!, {}, 3, 0.6);
    [
      [1318.5, 0.05],
      [1975.5, 0.03],
      [2637, 0.015],
    ].forEach(([f, p]) => this.tone(ctx, { freq: f, at: t + 0.7, attack: 0.003, dur: 1.6, peak: p, out: c.input }));
    this.tone(ctx, { freq: 1760, at: t + 0.82, attack: 0.003, dur: 1.4, peak: 0.035, out: c.input });
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
      setTimeout(() => lp.disconnect(), 4000);
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

  victory() {
    this.setMusicMode('over');
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.15;
    const s = this.strip(ctx, this.sfxBus!, {}, 6, 0.6);
    // Timpani pickup
    [0, 0.16, 0.32].forEach((d, i) =>
      this.tone(ctx, { freq: i === 2 ? 98 : 73, to: 50, at: t + d, attack: 0.002, dur: 0.6, peak: 0.35, out: s.input }),
    );
    // D major brass swell (D3 A3 D4 F#4 A4)
    const hit = t + 0.48;
    [50, 57, 62, 66, 69].forEach((m) => this.brass(ctx, s.input, hit, midiToHz(m), 3, 0.026, 3200));
    this.tone(ctx, { freq: 73.4, at: hit, attack: 0.01, dur: 3, peak: 0.25, out: s.input });
    // Rising sparkle
    [74, 78, 81, 86, 90, 93].forEach((m, i) =>
      this.tone(ctx, { type: 'triangle', freq: midiToHz(m), at: hit + 0.2 + i * 0.09, attack: 0.004, dur: 1.4, peak: 0.03, out: s.input }),
    );
    this.duck(1, 3, 1);
  }

  defeat() {
    this.setMusicMode('over');
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime + 0.15;
    const s = this.bossStrip(ctx, 6);
    // Dm with a flat-9 smear, sagging down.
    [38, 45, 50, 51, 53].forEach((m) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1200, t);
      lp.frequency.exponentialRampToValueAtTime(200, t + 3.2);
      lp.connect(s.input);
      this.tone(ctx, { type: 'sawtooth', freq: midiToHz(m), to: midiToHz(m - 2), glide: 3.2, at: t, attack: 0.3, dur: 3.2, peak: 0.03, out: lp });
      setTimeout(() => lp.disconnect(), 6000);
    });
    this.tone(ctx, { freq: 55, to: 36, at: t, attack: 0.2, dur: 3.4, peak: 0.3, out: s.input });
    this.brass(ctx, s.input, t + 0.9, midiToHz(38), 0.3, 0.06);
    this.brass(ctx, s.input, t + 1.2, midiToHz(37), 0.3, 0.06);
    this.brass(ctx, s.input, t + 1.5, midiToHz(33), 1.4, 0.07);
    this.chatter(ctx, s.input, t + 2.1, 18, 0.02);
    this.duck(1, 3, 1);
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
