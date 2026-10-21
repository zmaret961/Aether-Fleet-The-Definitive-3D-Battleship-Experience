/**
 * Audio director: listens to the game store and the FX bus and turns them into
 * spatialised SFX, boss stingers and adaptive-score cues. Battle sounds follow
 * the same events the 3D effects do, so audio and visuals always line up.
 */
import { shipAtCell } from '../game/board';
import type { Board } from '../game/board';
import { fx } from '../state/fx';
import { useGame } from '../state/store';
import type { Phase } from '../state/store';
import { audio } from './engine';
import { battleIntensity, panForColumn } from './music';
import type { MusicMode } from './music';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

const modeFor = (p: Phase): MusicMode =>
  p === 'battle' ? 'battle' : p === 'deploy' ? 'deploy' : p === 'over' ? 'over' : 'menu';

const afloat = (b: Board) => b.ships.filter((s) => !s.sunk).length;

let active: (() => void) | null = null;

/** Idempotent; returns a disposer (safe under React StrictMode double effects). */
export function initAudioDirector(): () => void {
  if (active) return active;

  const s0 = useGame.getState();
  audio.setVolume(s0.settings.volume);
  audio.setMuted(s0.settings.muted);
  audio.setMusicMode(modeFor(s0.phase));

  let lastEnemy = 5;
  let lastPlayer = 5;

  const unsubStore = useGame.subscribe((s, prev) => {
    if (s.settings !== prev.settings) {
      audio.setVolume(s.settings.volume);
      audio.setMuted(s.settings.muted);
    }

    if (s.phase !== prev.phase) {
      audio.setMusicMode(modeFor(s.phase));
      if (s.phase === 'battle') {
        lastEnemy = 5;
        lastPlayer = 5;
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
      }
      lastEnemy = e;
      lastPlayer = p;
    }
  });

  const unsubFx = fx.subscribe((e) => {
    if (e.type === 'marker') return;
    const far = e.side === 'enemy';
    const pan = panForColumn(e.coord.x, far);
    const match = useGame.getState().match;
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
      case 'explosion': {
        audio.explosion(e.side, pan);
        // A plain hit on us gets a Monolith taunt; sinking blows get the bigger laugh instead.
        const sunkNow = match ? shipAtCell(match.player, e.coord)?.sunk : false;
        if (e.side === 'player' && !sunkNow && !match?.winner && Math.random() < 0.7) audio.bossTaunt();
        break;
      }
      case 'sink':
        audio.sink(e.side, pan);
        if (!match?.winner) {
          if (e.side === 'player') audio.bossLaugh();
          else audio.bossHurt();
        }
        break;
    }
  });

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
    window.removeEventListener('keydown', onKey);
    active = null;
  };
  return active;
}
