import { useEffect, useRef, useState } from 'react';
import { useIsPresent } from 'framer-motion';
import { useGame } from '../state/store';
import { useUi } from './uiStore';

export type HotkeyMap = Partial<Record<string, (e: KeyboardEvent) => void>>;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
};

/** Normalised key: single characters lower-cased, named keys unchanged ("ArrowUp", "Enter", " "). */
export const keyOf = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

/**
 * Screen-level keyboard shortcuts. Suspended while a modal (settings / shortcut sheet)
 * is open, while typing, and for Enter/Space on a focused button so native activation wins.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  // a screen that is animating out must not keep handling keys meant for the next one
  const present = useIsPresent();
  const active = enabled && present;
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target)) return;
      if (useGame.getState().settingsOpen || useUi.getState().shortcutsOpen) return;
      const key = keyOf(e);
      const el = e.target as HTMLElement | null;
      if ((key === 'Enter' || key === ' ') && el && (el.tagName === 'BUTTON' || el.tagName === 'A')) return;
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

export const isTypingTarget = isTyping;

/** Animates 0 → target over `ms`; jumps straight to the value when motion is reduced. */
export function useCountUp(target: number, ms = 900, delay = 0) {
  const reduced = useGame((s) => s.settings.reducedMotion);
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay, reduced]);
  return value;
}
