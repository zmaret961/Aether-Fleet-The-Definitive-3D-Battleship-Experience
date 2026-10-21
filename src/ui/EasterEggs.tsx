import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { audio } from '../audio/engine';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const CONFETTI_COLORS = ['#67e8f9', '#22d3ee', '#a5f3fc', '#ffffff'];
const FOUND_KEY = 'aether-fleet:eggs';

interface Egg {
  id: string;
  title: string;
  detail: string;
  confetti?: boolean;
}

const KONAMI_EGG: Egg = {
  id: 'konami',
  title: 'Devin mode: full autonomy unlocked',
  detail: 'Up, up, down, down... Devin already wrote the tests for that.',
  confetti: true,
};

// Typed anywhere outside a text field. None use P or R (pause / rotate keys).
const WORD_EGGS: Record<string, Egg> = {
  cobol: {
    id: 'cobol',
    title: 'IDENTIFICATION DIVISION.',
    detail: 'The Legacy Monolith recognises its mother tongue. It is not amused.',
  },
  lgtm: {
    id: 'lgtm',
    title: 'Devin Review flagged this comment',
    detail: '"LGTM" without reading the diff is not a review. Request changes.',
  },
  sudo: {
    id: 'sudo',
    title: 'Permission denied',
    detail: 'Nice try. Devin runs with scoped credentials, not root.',
  },
  acu: {
    id: 'acu',
    title: 'ACU meter: 0.25 per shot',
    detail: 'Cheaper than a war room. Much cheaper than a COBOL contractor.',
  },
  wiki: {
    id: 'wiki',
    title: 'DeepWiki indexed the enemy',
    detail: 'Architecture: one 40-year-old mainframe. Owner: "Gary (retired)".',
  },
  devin: {
    id: 'devin',
    title: 'Devin is already on it',
    detail: 'Session started. Plan drafted. You can go get coffee.',
    confetti: true,
  },
  windsurf: {
    id: 'windsurf',
    title: 'Surf\u2019s up',
    detail: 'Windsurf catches the wave. Jeff Wang approves.',
  },
};
const TOTAL_EGGS = Object.keys(WORD_EGGS).length + 1;
const LONGEST_WORD = Math.max(...Object.keys(WORD_EGGS).map((w) => w.length));

const loadFound = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOUND_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

export function EasterEggs() {
  const [egg, setEgg] = useState<(Egg & { found: number; seq: number }) | null>(null);
  const progress = useRef(0);
  const typed = useRef('');
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trigger = (next: Egg) => {
      const found = loadFound();
      found.add(next.id);
      try {
        localStorage.setItem(FOUND_KEY, JSON.stringify([...found]));
      } catch {
        /* private mode */
      }
      audio.sonarPulse();
      setEgg({ ...next, found: found.size, seq: Date.now() });
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setEgg(null), 4200);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === KONAMI[progress.current]) {
        progress.current += 1;
      } else {
        progress.current = key === KONAMI[0] ? 1 : 0;
      }
      if (progress.current === KONAMI.length) {
        progress.current = 0;
        trigger(KONAMI_EGG);
        return;
      }

      if (key.length !== 1) return;
      typed.current = (typed.current + key).slice(-LONGEST_WORD);
      const word = Object.keys(WORD_EGGS).find((w) => typed.current.endsWith(w));
      if (word) {
        typed.current = '';
        trigger(WORD_EGGS[word]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {egg && (
        <m.div key={egg.seq} className="pointer-events-none">
          <m.div
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className="field-toast fixed left-1/2 top-8 z-[80] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-accent/40 bg-[#071827]/90 px-6 py-3 text-center shadow-[0_0_45px_rgba(34,211,238,0.2)] backdrop-blur-xl"
            role="status"
          >
            <div className="text-sm font-semibold tracking-wide text-white">{egg.title}</div>
            <div className="mt-1 text-xs text-white/60">{egg.detail}</div>
            <div className="label-caps mt-2 !text-[0.5rem]">
              Easter egg {egg.found}/{TOTAL_EGGS} found
            </div>
          </m.div>
          {egg.confetti && (
            <div className="confetti-burst" aria-hidden="true">
              {Array.from({ length: 40 }, (_, index) => {
                const angle = (index / 40) * Math.PI * 2;
                const distance = 90 + ((index * 37) % 150);
                const style = {
                  '--dx': `${Math.cos(angle) * distance}px`,
                  '--dy': `${Math.sin(angle) * distance - 30}px`,
                  '--confetti-color': CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                  '--confetti-delay': `${(index % 7) * 0.025}s`,
                } as CSSProperties;
                return <span key={index} style={style} />;
              })}
            </div>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
}
