import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const CONFETTI_COLORS = ['#67e8f9', '#22d3ee', '#a5f3fc', '#ffffff'];

export function EasterEggs() {
  const [visible, setVisible] = useState(false);
  const progress = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === KONAMI[progress.current]) {
        progress.current += 1;
      } else {
        progress.current = key === KONAMI[0] ? 1 : 0;
      }

      if (progress.current === KONAMI.length) {
        progress.current = 0;
        setVisible(true);
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => setVisible(false), 4200);
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
      {visible && (
        <>
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className="field-toast fixed left-1/2 top-8 z-[80] -translate-x-1/2 rounded-2xl border border-accent/40 bg-[#071827]/90 px-6 py-3 text-center shadow-[0_0_45px_rgba(34,211,238,0.2)] backdrop-blur-xl"
          >
            <div className="text-sm font-semibold tracking-wide text-white">Devin mode: full autonomy unlocked</div>
          </motion.div>
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
        </>
      )}
    </AnimatePresence>
  );
}
