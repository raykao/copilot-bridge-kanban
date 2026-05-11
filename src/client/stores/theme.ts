import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

type ResolvedTheme = 'light' | 'dark';

export interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}

const SYSTEM_THEME_MEDIA = '(prefers-color-scheme: dark)';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia(SYSTEM_THEME_MEDIA).matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

const initialMode: ThemeMode = 'system';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: initialMode,
      resolved: resolveTheme(initialMode),
      setTheme: (mode) => {
        const resolved = resolveTheme(mode);
        applyTheme(resolved);
        set({ mode, resolved });
      },
    }),
    {
      name: 'kanban-theme',
      partialize: (state) => ({ mode: state.mode }),
      merge: (persistedState, currentState) => {
        const mode = (persistedState as Partial<ThemeState> | undefined)?.mode ?? currentState.mode;
        const resolved = resolveTheme(mode);

        return {
          ...currentState,
          ...(persistedState as Partial<ThemeState> | undefined),
          mode,
          resolved,
        };
      },
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.resolved ?? resolveTheme(initialMode));
      },
    },
  ),
);

applyTheme(useThemeStore.getState().resolved);

useThemeStore.subscribe((state, previousState) => {
  if (state.resolved !== previousState.resolved) {
    applyTheme(state.resolved);
  }
});

if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia(SYSTEM_THEME_MEDIA);
  const handleSystemThemeChange = () => {
    const state = useThemeStore.getState();

    if (state.mode !== 'system') {
      return;
    }

    const resolved = resolveTheme('system');
    applyTheme(resolved);

    if (state.resolved !== resolved) {
      useThemeStore.setState({ resolved });
    }
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleSystemThemeChange);
  } else {
    mediaQuery.addListener(handleSystemThemeChange);
  }
}
