import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { m } from 'framer-motion';
import { audio } from '../audio/engine';
import { useGame } from '../state/store';

export function GlassPanel({
  children,
  className = '',
  strong = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; strong?: boolean }) {
  return (
    <div className={`${strong ? 'glass glass-strong' : 'glass'} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`kbd ${className}`} aria-hidden="true">
      {children}
    </kbd>
  );
}

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  /** keyboard shortcut hint rendered as a keycap */
  hotkey?: string;
  children: ReactNode;
}

export function GlassButton({
  variant = 'ghost',
  hotkey,
  children,
  className = '',
  onClick,
  ...rest
}: GlassButtonProps) {
  const variantClass = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost';
  return (
    <button
      type="button"
      className={`glass-interactive inline-flex items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm font-semibold tracking-wide select-none cursor-pointer ${variantClass} ${className}`}
      onMouseEnter={(e) => {
        if (!e.currentTarget.disabled) audio.hover();
      }}
      onClick={(e) => {
        audio.click();
        onClick?.(e);
      }}
      aria-keyshortcuts={hotkey}
      {...rest}
    >
      {children}
      {hotkey && <Kbd className="-mr-1.5 max-sm:!hidden">{hotkey}</Kbd>}
    </button>
  );
}

export const FadeIn = ({
  children,
  delay = 0,
  className = '',
  from = 'below',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  from?: 'below' | 'above' | 'left' | 'right';
}) => {
  const reduced = useGame((s) => s.settings.reducedMotion);
  const offset = reduced ? 0 : 18;
  const initial = {
    opacity: 0,
    x: from === 'left' ? -offset : from === 'right' ? offset : 0,
    y: from === 'below' ? offset : from === 'above' ? -offset : 0,
    scale: reduced ? 1 : 0.985,
  };
  return (
    <m.div
      initial={initial}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : -12, scale: reduced ? 1 : 0.99 }}
      transition={{ duration: reduced ? 0.15 : 0.5, delay: reduced ? 0 : delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </m.div>
  );
};

/** Eyebrow + display title + optional subtitle, used at the top of every menu screen. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  subtitleClassName = '',
  className = '',
  size = 'lg',
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleClassName?: string;
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div className={`text-center ${className}`}>
      <div className="mb-4 flex justify-center">
        <span className="chip border-accent/30 bg-accent/10 text-accent">
          <span className="live-dot h-1.5 w-1.5" />
          <span className="uppercase tracking-[0.2em]">{eyebrow}</span>
        </span>
      </div>
      <h2 className={`title-display pb-1 ${size === 'lg' ? 'text-4xl sm:text-6xl' : 'text-3xl sm:text-5xl'}`}>{title}</h2>
      {subtitle && <p className={`mx-auto mt-3 max-w-xl text-sm text-white/70 sm:text-base ${subtitleClassName}`}>{subtitle}</p>}
    </div>
  );
}

/** Tiny caption row: "Press <kbd> to …" hints. */
export function KeyHint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/60">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}
