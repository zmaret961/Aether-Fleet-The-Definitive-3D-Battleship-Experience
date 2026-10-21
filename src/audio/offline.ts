/**
 * Offline mix renders for calibrating loudness and judging the mix by ear.
 * Dev-only: nothing in the app imports this. From a dev-server page:
 *   const m = await import('/src/audio/offline.ts');
 *   const wav = m.toWav(await m.renderScene('battle'));
 * `scripts/render-audio.mjs` automates that and measures LUFS with ffmpeg.
 */
import type { CommanderId } from '../game/types';
import type { BossMood } from '../state/fx';
import { MISSILE_FLIGHT_MS } from '../state/fx';
import { AudioEngine } from './engine';
import { battleIntensity, panForColumn } from './music';

export type Scene = 'menu' | 'battle' | 'boss' | 'stings';

type Cue = [at: number, run: (a: AudioEngine) => void];

const RATE = 48000;

/** A seeded RNG so every render of a scene is the same battle. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

function battleCues(seconds: number): Cue[] {
  const r = rng(7);
  const cues: Cue[] = [[0, (a) => (a.setMusicMode('battle'), a.setIntensity(battleIntensity(5, 5)), a.bossEntrance())]];
  let enemy = 5;
  let player = 5;
  let t = 3.2;
  const flight = MISSILE_FLIGHT_MS / 1000;
  const mood = (at: number, m: BossMood) => cues.push([at, (a) => a.bossVoice(m)]);
  for (let turn = 0; t < seconds - 3; turn++) {
    // Our shot: click, sonar, missile, result.
    const x = Math.floor(r() * 10);
    const pan = panForColumn(x, true);
    cues.push([t, (a) => (a.click(), a.sonarPulse({ pan, far: 1 }), a.launch('enemy', pan))]);
    const hit = r() < 0.45;
    const sink = hit && enemy > 1 && turn % 4 === 3;
    cues.push([t + flight, (a) => (hit ? a.explosion('enemy', pan) : a.splash('enemy', pan, true))]);
    mood(t + flight, hit ? 'hurt' : 'laugh');
    if (sink) {
      const e = --enemy;
      cues.push([t + flight + 0.35, (a) => (a.sink('enemy', pan), a.setIntensity(battleIntensity(e, player), player <= 2))]);
      mood(t + flight + 0.35, 'rage');
    }
    // The Monolith's reply after its review delay.
    const at = t + flight + 1.25;
    const px = Math.floor(r() * 10);
    const ppan = panForColumn(px, false);
    cues.push([at, (a) => a.launch('player', ppan)]);
    mood(at, 'charge');
    const aiHit = r() < 0.4;
    const aiSink = aiHit && player > 2 && turn % 5 === 4;
    cues.push([at + flight, (a) => (aiHit ? a.explosion('player', ppan) : a.splash('player', ppan, false))]);
    mood(at + flight, aiHit ? 'gloat' : 'smug');
    if (aiSink) {
      const p = --player;
      cues.push([at + flight + 0.35, (a) => (a.sink('player', ppan), a.setIntensity(battleIntensity(enemy, p), p <= 2))]);
      mood(at + flight + 0.35, 'gloat');
    }
    t = at + flight + 1.4;
  }
  return cues;
}

const COMMANDER_IDS: CommanderId[] = ['scott-wu', 'chris-degnan', 'jeff-wang', 'will-mccarthy'];

function scene(name: Scene, seconds: number): Cue[] {
  switch (name) {
    case 'menu':
      return [[0, (a) => a.setMusicMode('menu')]];
    case 'battle':
      return battleCues(seconds);
    case 'boss': {
      const moods: BossMood[] = ['smug', 'laugh', 'gloat', 'hurt', 'rage', 'charge', 'dead', 'victory'];
      return [[0, (a) => (a.setMusicMode('battle'), a.setIntensity(0.4))], ...moods.map((m, i): Cue => [1 + i * 3.5, (a) => a.bossVoice(m)])];
    }
    case 'stings':
      return [
        [0, (a) => a.setMusicMode('menu')],
        ...COMMANDER_IDS.map((id, i): Cue => [1.5 + i * 2.6, (a) => a.commanderMotif(id)]),
        [12.5, (a) => a.victory()],
        [14, (a) => a.resultSting(true)],
        [21, (a) => a.defeat()],
        [22.5, (a) => a.resultSting(false)],
      ];
  }
}

export async function renderScene(name: Scene, seconds = name === 'menu' ? 80 : name === 'battle' ? 60 : name === 'boss' ? 30 : 30): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * RATE), sampleRate: RATE });
  const a = new AudioEngine(ctx);
  a.setVolume(0.8);
  a.setMusicVolume(0.8);
  a.setSfxVolume(0.9);
  a.startAmbient();
  a.setAmbientLevel(name === 'menu' ? 0.16 : 0.2);
  const cues = scene(name, seconds).sort((x, y) => x[0] - y[0]);
  const TICK = 0.04;
  let i = 0;
  const step = async (t: number) => {
    while (i < cues.length && cues[i][0] <= t + 1e-6) cues[i++][1](a);
    a.pump();
    const next = t + TICK;
    if (next < seconds) {
      void ctx.suspend(next).then(() => step(next).then(() => ctx.resume()));
    }
  };
  await step(0);
  return ctx.startRendering();
}

/** 16-bit PCM WAV. */
export function toWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}
