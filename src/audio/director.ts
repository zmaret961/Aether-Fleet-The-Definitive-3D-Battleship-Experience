/**
 * Audio director: listens to the game store and the FX bus and turns them into
 * spatialised SFX, the Monolith's voice and adaptive-score cues. Battle sounds
 * follow the same events the 3D effects do, so audio and visuals always line up.
 */
import { COMMANDERS } from '../game/types';
import type { Board } from '../game/board';
import { fx } from '../state/fx';
import type { BossMood, FxEvent } from '../state/fx';
import { useGame } from '../state/store';
import type { Phase } from '../state/store';
import { audio } from './engine';
import { battleIntensity, panForColumn } from './music';
import type { MusicMode } from './music';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

const modeFor = (p: Phase): MusicMode =>
  p === 'battle' ? 'battle' : p === 'deploy' ? 'deploy' : p === 'over' ? 'over' : 'menu';

const ambientFor = (p: Phase) => (p === 'battle' || p === 'deploy' ? 0.2 : 0.16);

const afloat = (b: Board) => b.ships.filter((s) => !s.sunk).length;

/**
 * Same mapping the Monolith uses for its face. Only used until the 3D boss
 * reports a real 'bossMood' (e.g. scene still loading, or low-power mode).
 */
export const fallbackMood = (e: FxEvent): BossMood | null => {
  if (e.type === 'bossMood' || e.type === 'marker' || e.type === 'sonar') return null;
  if (e.side === 'enemy') return e.type === 'explosion' ? 'hurt' : e.type === 'splash' ? 'laugh' : e.type === 'sink' ? 'rage' : null;
  return e.type === 'missile' ? 'charge' : e.type === 'explosion' || e.type === 'sink' ? 'gloat' : e.type === 'splash' ? 'smug' : null;
};

let active: (() => void) | null = null;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __aetherAudio: typeof audio }).__aetherAudio = audio;
}

/** Idempotent; returns a disposer (safe under React StrictMode double effects). */
export function initAudioDirector(): () => void {
  if (active) return active;

  const applySettings = () => {
    const { settings } = useGame.getState();
    audio.setVolume(settings.volume);
    audio.setMusicVolume(settings.musicVolume);
    audio.setSfxVolume(settings.sfxVolume);
    audio.setMuted(settings.muted);
  };
  applySettings();
  audio.setMusicMode(modeFor(useGame.getState().phase));

  // No AudioContext until a real gesture: no autoplay warnings, ever.
  const removeUnlock = audio.installGestureUnlock(() => {
    applySettings();
    audio.startAmbient();
    audio.setAmbientLevel(ambientFor(useGame.getState().phase));
  });

  let lastEnemy = 5;
  let lastPlayer = 5;
  let bossTalks = false;

  const unsubStore = useGame.subscribe((s, prev) => {
    if (s.settings !== prev.settings) applySettings();
    if (s.paused !== prev.paused) audio.setPaused(s.paused);

    if (s.phase !== prev.phase) {
      audio.setMusicMode(modeFor(s.phase));
      if (prev.phase === 'commander' && s.phase === 'difficulty') audio.commanderMotif(s.commanderId);
      if (s.phase === 'over' && s.match?.winner) audio.resultSting(s.match.winner === 'player');
      if (s.phase !== 'battle') audio.setPaused(false);
      if (s.phase === 'battle') {
        lastEnemy = 5;
        lastPlayer = 5;
        bossTalks = false;
        audio.setIntensity(battleIntensity(5, 5));
        audio.bossEntrance();
      }
    }

    if (s.phase === 'battle' && s.match && (s.matchVersion !== prev.matchVersion || s.match !== prev.match)) {
      const e = afloat(s.match.enemy);
      const p = afloat(s.match.player);
      audio.setIntensity(battleIntensity(e, p), p <= 2);
      if (!s.match.winner) {
        if (p === 1 && lastPlayer > 1) audio.lastStand('player');
        else if (e === 1 && lastEnemy > 1) audio.lastStand('enemy');
      } else if (!bossTalks) {
        audio.bossVoice(s.match.winner === 'player' ? 'dead' : 'victory');
      }
      lastEnemy = e;
      lastPlayer = p;
    }
  });

  const unsubFx = fx.subscribe((e) => {
    if (e.type === 'bossMood') {
      bossTalks = true;
      audio.bossVoice(e.mood);
      return;
    }
    if (!bossTalks && !useGame.getState().match?.winner) {
      const m = fallbackMood(e);
      if (m) audio.bossVoice(m);
    }
    if (e.type === 'marker') return;
    const far = e.side === 'enemy';
    const pan = panForColumn(e.coord.x, far);
    switch (e.type) {
      case 'sonar':
        audio.sonarPulse({ pan, far: far ? 1 : 0 });
        break;
      case 'missile':
        audio.launch(e.side, pan);
        break;
      case 'splash':
        audio.splash(e.side, pan, e.big ?? true);
        break;
      case 'explosion':
        audio.explosion(e.side, pan);
        break;
      case 'sink':
        audio.sink(e.side, pan);
        break;
    }
  });

  // Commander select: a quiet preview of each call sign on hover / keyboard focus.
  let previewed = '';
  const onPreview = (ev: Event) => {
    if (useGame.getState().phase !== 'commander') return;
    const card = (ev.target as Element | null)?.closest?.('[role="radiogroup"][aria-label="Commander"] [role="radio"]');
    const idx = Number(card?.getAttribute('aria-keyshortcuts')) - 1;
    const c = COMMANDERS[idx];
    if (!c) {
      if (ev.type === 'pointerover' && !card) previewed = '';
      return;
    }
    if (c.id === previewed) return;
    previewed = c.id;
    audio.commanderMotif(c.id, true);
  };
  document.addEventListener('pointerover', onPreview);
  document.addEventListener('focusin', onPreview);

  let konami = 0;
  const onKey = (ev: KeyboardEvent) => {
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) {
      konami = 0;
      audio.easterEgg();
    }
  };
  window.addEventListener('keydown', onKey);

  active = () => {
    unsubStore();
    unsubFx();
    removeUnlock();
    document.removeEventListener('pointerover', onPreview);
    document.removeEventListener('focusin', onPreview);
    window.removeEventListener('keydown', onKey);
    active = null;
  };
  return active;
}
