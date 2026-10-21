import { createRoot } from 'react-dom/client';
import { domAnimation, LazyMotion } from 'framer-motion';
import './index.css';
import App from './App';
import { PwaLayer } from './pwa/PwaLayer';
import { dismissSplashWhenReady } from './pwa/splash';
import { useGame } from './state/store';
import { useQuality } from './three/quality';

// `m.*` + domAnimation instead of `motion.*` (which drags in drag/layout/pan
// features). Loaded synchronously: the menu hero is the LCP element and must
// not wait on a lazy chunk while the 3D bundle is busy compiling shaders.

const syncQuality = () => useQuality.getState().setSetting(useGame.getState().settings.perfMode);
syncQuality();
useGame.subscribe((s, prev) => {
  if (s.settings.perfMode !== prev.settings.perfMode) syncQuality();
});

createRoot(document.getElementById('root')!).render(
  <LazyMotion features={domAnimation} strict>
    <App />
    <PwaLayer />
  </LazyMotion>,
);

dismissSplashWhenReady();
