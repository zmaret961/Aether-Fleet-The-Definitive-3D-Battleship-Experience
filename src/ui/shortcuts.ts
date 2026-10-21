export interface ShortcutItem {
  keys: string[];
  label: string;
  /** surfaced on the How to Play card */
  howto?: boolean;
}

export const SHORTCUT_GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['?'], label: 'Show shortcuts' },
      { keys: ['S'], label: 'Settings' },
      { keys: ['M'], label: 'Mute / unmute', howto: true },
      { keys: ['Esc'], label: 'Back / close' },
    ],
  },
  {
    title: 'Menus',
    items: [
      { keys: ['Enter'], label: 'Continue' },
      { keys: ['1', '–', '4'], label: 'Pick commander / mission' },
    ],
  },
  {
    title: 'Deploy',
    items: [
      { keys: ['1', '–', '5'], label: 'Select ship', howto: true },
      { keys: ['R'], label: 'Rotate ship', howto: true },
      { keys: ['A'], label: 'Auto-deploy fleet', howto: true },
      { keys: ['X'], label: 'Reset formation' },
      { keys: ['Enter'], label: 'Begin battle' },
    ],
  },
  {
    title: 'Battle',
    items: [
      { keys: ['←', '↑', '↓', '→'], label: 'Move firing solution', howto: true },
      { keys: ['Enter'], label: 'Fire', howto: true },
      { keys: ['Space'], label: 'Fire' },
      { keys: ['Q'], label: 'Ask DeepWiki' },
      { keys: ['Esc'], label: 'Clear target' },
    ],
  },
  {
    title: 'Field report',
    items: [
      { keys: ['Enter'], label: 'Play again' },
      { keys: ['Esc'], label: 'Main menu' },
    ],
  },
];
