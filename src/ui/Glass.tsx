import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { audio } from '../audio/engine';

export function GlassPanel({
  children,
  className = '',
  strong = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; strong?: boolean }) {
  return (
    <div className={`${strong ? 'glass-strong glass' : 'glass'} ${className}`} {...rest}>
      {children}
    </div>
  );
}

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  children: ReactNode;
}

export function GlassButton({ variant = 'ghost', children, className = '', onClick, ...rest }: GlassButtonProps) {
  return (
    <button
      className={`glass-interactive rounded-xl px-5 py-3 text-sm font-semibold tracking-wide select-none cursor-pointer ${
        variant === 'primary' ? 'btn-primary' : 'btn-ghost'
      } ${className}`}
      onMouseEnter={() => audio.hover()}
      onClick={(e) => {
        audio.click();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export const FadeIn = ({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 18, scale: 0.985 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -14, scale: 0.99 }}
    transition={{ duration: 0.45, delay, ease: [0.22, 1.2, 0.36, 1] }}
    className={className}
  >
    {children}
  </motion.div>
);
