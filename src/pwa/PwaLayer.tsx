/// <reference types="vite-plugin-pwa/react" />
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useGame } from '../state/store';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const IOS_HINT_KEY = 'aether-fleet:ios-install-hint';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIosSafari = () => /iP(hone|ad|od)/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

/** Service-worker registration, "ready offline" toast and the install chip on the main menu. */
export function PwaLayer() {
  const phase = useGame((s) => s.phase);
  const {
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({ immediate: true });
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    try {
      if (isIosSafari() && !isStandalone() && !localStorage.getItem(IOS_HINT_KEY)) setIosHint(true);
    } catch {
      /* private mode */
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(() => setOfflineReady(false), 4200);
    return () => window.clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  const dismissIosHint = () => {
    setIosHint(false);
    try {
      localStorage.setItem(IOS_HINT_KEY, '1');
    } catch {
      /* private mode */
    }
  };

  const onMenu = phase === 'menu';

  return (
    <>
      {onMenu && installEvent && (
        <button
          type="button"
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice.catch(() => undefined);
            setInstallEvent(null);
          }}
          className="glass glass-interactive pwa-corner fixed z-40 flex items-center gap-2 !rounded-full px-4 py-2 text-xs font-semibold tracking-wide cursor-pointer"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current text-accent">
            <path d="M8 1.5a.75.75 0 0 1 .75.75v6.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5ZM2.75 13a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z" />
          </svg>
          Install app
        </button>
      )}
      {onMenu && !installEvent && iosHint && (
        <div className="glass pwa-corner fixed z-40 flex max-w-[15rem] items-start gap-2 !rounded-2xl px-3.5 py-2.5 text-[0.7rem] leading-snug text-white/80">
          <span>
            Install: tap <span className="font-semibold text-white">Share</span>, then{' '}
            <span className="font-semibold text-white">Add to Home Screen</span>.
          </span>
          <button type="button" aria-label="Dismiss install hint" onClick={dismissIosHint} className="-mr-1 px-1 text-white/50 cursor-pointer">
            ×
          </button>
        </div>
      )}
      {offlineReady && (
        <div
          role="status"
          className="glass fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[90] -translate-x-1/2 !rounded-full px-4 py-2 text-xs text-white/85 whitespace-nowrap"
        >
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle shadow-[0_0_8px_#34d399]" />
          Snapshot cached · the fleet now sails offline
        </div>
      )}
    </>
  );
}
