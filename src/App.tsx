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
import { useGame } from './state/store';
import { audio } from './audio/engine';

// three.js + R3F load as a separate chunk so the UI shell paints first.
const Scene = lazy(() => import('./three/Scene').then((m) => ({ default: m.Scene })));

export default function App() {
  const phase = useGame((s) => s.phase);
  const reducedMotion = useGame((s) => s.settings.reducedMotion);
  const highContrast = useGame((s) => s.settings.highContrast);

  // Audio requires a user gesture; warm the ambient bed on first interaction.
  useEffect(() => {
    const kick = () => {
      audio.startAmbient();
      audio.setAmbientLevel(0.16);
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
    document.documentElement.classList.toggle('high-contrast', highContrast);
  }, [reducedMotion, highContrast]);

  // Keyboard: Enter confirms fire, Escape deselects, R rotates during deploy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useGame.getState();
      if (e.key === 'Enter' && s.phase === 'battle' && s.target) s.confirmFire();
      if ((e.key === 'r' || e.key === 'R') && s.phase === 'deploy') s.rotateDeploy();
      if (e.key === 'Escape' && s.settingsOpen) s.setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      <EasterEggs />
      <SettingsPanel />
    </div>
  );
}
