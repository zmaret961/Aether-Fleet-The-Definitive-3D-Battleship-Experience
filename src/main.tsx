import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { PwaLayer } from './pwa/PwaLayer';
import { dismissSplashWhenReady } from './pwa/splash';

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <PwaLayer />
  </>,
);

dismissSplashWhenReady();
