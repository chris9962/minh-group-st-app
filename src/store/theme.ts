import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';
export type Accent = 'orange' | 'blue' | 'cyan' | 'pink' | 'slate';

type ThemeStore = {
  theme: Theme;
  accent: Accent;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  setAccent: (accent: Accent) => void;
};

/** Gắn lên thẻ html — CSS đọc qua `:root[data-theme="dark"]`. */
export function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

/** Gắn lên thẻ html — CSS đọc qua `:root[data-accent="blue"]`. */
export function applyAccent(accent: Accent) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.accent = accent;
  }
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      accent: 'orange',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      setAccent: (accent) => {
        applyAccent(accent);
        set({ accent });
      },
    }),
    {
      name: 'mgst-theme',
      // Đọc xong từ localStorage thì gắn ngay: script trong <head> đã gắn sẵn
      // để tránh chớp màu, đây là lần đồng bộ lại cho chắc.
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
          applyAccent(state.accent);
        }
      },
    },
  ),
);
