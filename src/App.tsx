import { lazy, Suspense, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BattleScreen } from './ui/BattleScreen';
import { CommanderSelect } from './ui/CommanderSelect';
import { DeployScreen } from './ui/DeployScreen';
import { DifficultySelect } from './ui/DifficultySelect';
import { HowTo } from './ui/HowTo';
import { MainMenu } from './ui/MainMenu';
import { ResultScreen } from './ui/ResultScreen';
import { EasterEggs } from './ui/EasterEggs';
import { SettingsPanel } from './ui/SettingsPanel';
import { PauseOverlay } from './ui/PauseOverlay';
import { useGame } from './state/store';
import { initAudioDirector } from './audio/director';
import { FLEET } from './game/types';

// three.js + R3F load as a separate chunk so the UI shell paints first.
const Scene = lazy(() => import('./three/Scene').then((m) => ({ default: m.Scene })));

export default function App() {
  const phase = useGame((s) => s.phase);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const highContrast = useGame((s) => s.settings.highContrast);

  useEffect(() => initAudioDirector(), []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
    document.documentElement.classList.toggle('high-contrast', highContrast);
  }, [reducedMotion, highContrast]);

  // Keyboard: Enter fires (or launches a fully deployed fleet), R rotates
  // during deploy, P / Escape pause the battle, Escape closes settings first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      const s = useGame.getState();
      if (e.key === 'Escape' && s.settingsOpen) {
        s.setSettingsOpen(false);
        return;
      }
      if (s.settingsOpen) return;
      const key = e.key.toLowerCase();
      if (s.phase === 'battle' && (key === 'p' || e.key === 'Escape')) {
        e.preventDefault();
        s.togglePause();
        return;
      }
      if (e.key === 'Enter') {
        // Buttons handle their own Enter; don't double-fire.
        if (el?.tagName === 'BUTTON') return;
        if (s.phase === 'battle' && s.target && !s.paused) s.confirmFire();
        if (s.phase === 'deploy' && s.deploy.board.ships.length === FLEET.length) s.beginBattle();
      }
      if (key === 'r' && s.phase === 'deploy') s.rotateDeploy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tabbing away mid-battle pauses instead of letting Legacy fire unseen.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) useGame.getState().pauseGame();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden select-none">
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
      <AnimatePresence mode="wait">
        {phase === 'menu' && <MainMenu key="menu" />}
        {phase === 'commander' && <CommanderSelect key="commander" />}
        {phase === 'difficulty' && <DifficultySelect key="diff" />}
        {phase === 'howto' && <HowTo key="how" />}
        {phase === 'deploy' && <DeployScreen key="dep" />}
        {phase === 'battle' && <BattleScreen key="bat" />}
        {phase === 'over' && <ResultScreen key="over" />}
      </AnimatePresence>
      <PauseOverlay />
      <EasterEggs />
      <SettingsPanel />
    </div>
  );
}
