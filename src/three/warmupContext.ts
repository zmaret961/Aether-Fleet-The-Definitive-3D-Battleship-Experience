import { createContext, useContext } from 'react';

export const WarmupContext = createContext(false);

/** True inside the hidden shader warm-up copy (Warmup.tsx): skip side effects such as fx.emit, audio and timers. */
export const useIsWarmup = () => useContext(WarmupContext);
