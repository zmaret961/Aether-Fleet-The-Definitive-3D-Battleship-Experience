import { create } from 'zustand';

interface UiState {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

/** UI-only state that the game store doesn't need to know about. */
export const useUi = create<UiState>((set) => ({
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
}));
