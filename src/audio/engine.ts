/**
 * Procedural Web Audio engine — every sound is synthesized, no asset files.
 * Deep-ocean ambience, sonar pulses, weapons fire, impacts and sinking.
 */

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientStarted = false;
  private _volume = 0.8;
  private _muted = false;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : this._volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this._volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this._volume, this.ctx.currentTime, 0.05);
  }

  get muted() {
    return this._muted;
  }

  /** Call from any user gesture. Starts the deep-ocean bed once. */
  startAmbient() {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.ambientStarted) return;
    this.ambientStarted = true;

    // Layered brown noise through a slow-moving lowpass = abyssal water.
    const noiseBuf = this.brownNoise(ctx, 4);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const amb = ctx.createGain();
    amb.gain.value = 0.16;
    src.connect(lp).connect(amb).connect(this.master);
    src.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    this.ambientGain = amb;

    // Sparse distant sonar ping.
    setInterval(() => this.distantSonar(), 11000);
  }

  setAmbientLevel(v: number) {
    if (this.ambientGain && this.ctx) this.ambientGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  private brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  private env(gain: GainNode, t0: number, attack: number, peak: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private osc(type: OscillatorType, freq: number, t0: number, dur: number, peak: number, bend?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(1, bend), t0 + dur);
    const g = ctx.createGain();
    this.env(g, t0, 0.005, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(t0: number, dur: number, peak: number, filterFreq: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    this.env(g, t0, 0.004, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  private distantSonar() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    this.osc('sine', 840, t0, 1.6, 0.05);
    this.osc('sine', 1680, t0, 1.2, 0.015);
  }

  // --- UI -------------------------------------------------------------------
  click() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.osc('sine', 620, ctx.currentTime, 0.07, 0.12, 420);
  }
  hover() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.osc('sine', 980, ctx.currentTime, 0.035, 0.035);
  }
  place() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.osc('triangle', 340, t0, 0.12, 0.14, 250);
    this.noise(t0, 0.18, 0.08, 500);
  }
  rotate() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.osc('triangle', 480, ctx.currentTime, 0.09, 0.1, 640);
  }
  error() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.osc('square', 160, ctx.currentTime, 0.12, 0.07, 120);
  }

  // --- Battle ---------------------------------------------------------------
  sonarPulse() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.osc('sine', 1180, t0, 0.5, 0.16, 1180);
    this.osc('sine', 590, t0 + 0.06, 0.6, 0.08);
  }
  fire() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.noise(t0, 0.35, 0.22, 900);
    this.osc('sine', 240, t0, 0.4, 0.16, 60);
  }
  miss() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.noise(t0, 0.5, 0.16, 700);
    this.osc('sine', 300, t0 + 0.02, 0.4, 0.05, 140);
  }
  hit() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.noise(t0, 0.45, 0.3, 2400, 'bandpass');
    this.osc('sawtooth', 90, t0, 0.5, 0.2, 40);
    this.osc('triangle', 620, t0 + 0.03, 0.2, 0.12, 300);
  }
  sink() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.osc('sawtooth', 120, t0, 1.8, 0.24, 28);
    this.noise(t0 + 0.1, 1.4, 0.26, 400);
    this.osc('sine', 70, t0 + 0.4, 1.6, 0.18, 22);
    for (let i = 0; i < 4; i++) this.noise(t0 + 0.15 * i, 0.2, 0.1, 1200, 'bandpass');
  }
  victory() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.osc('triangle', f, t0 + i * 0.16, 0.9, 0.14));
  }
  defeat() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.osc('sawtooth', 110, t0, 2.4, 0.16, 55);
    this.osc('sine', 55, t0 + 0.2, 2.2, 0.14, 36);
  }
}

export const audio = new AudioEngine();
