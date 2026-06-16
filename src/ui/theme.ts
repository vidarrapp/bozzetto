/**
 * App-wide light/dark theme. Sets `data-theme` on <html> (CSS variables key off
 * it) and remembers the choice. Call initTheme() before first paint.
 */
export type Theme = 'dark' | 'light';

const KEY = 'bozzetto-theme';

/** 3D viewport background per theme — warm ink / warm cream. */
export const THEME_BG: Record<Theme, string> = {
  dark: '#1c1814',
  light: '#f1ebe1',
};

export function initTheme(): Theme {
  let theme: Theme = 'dark';
  try {
    if (localStorage.getItem(KEY) === 'light') theme = 'light';
  } catch {
    /* storage unavailable */
  }
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}
