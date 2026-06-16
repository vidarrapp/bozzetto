/**
 * App-wide light/dark theme. Sets `data-theme` on <html> (CSS variables key off
 * it), persists the choice, and broadcasts changes so an active viewer can
 * re-tint its 3D background. Call initTheme() before first paint and
 * mountThemeToggle() once per page.
 */
export type Theme = 'dark' | 'light';

const KEY = 'bozzetto-theme';
const EVENT = 'bozzetto:themechange';

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
  window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: theme }));
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function onThemeChange(cb: (theme: Theme) => void): () => void {
  const handler = (e: Event): void => cb((e as CustomEvent<Theme>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Mount the global ink/cream toggle button (top-right). Idempotent per page. */
export function mountThemeToggle(): void {
  if (document.querySelector('.theme-toggle')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';

  const sync = (): void => {
    const theme = getTheme();
    button.textContent = theme === 'dark' ? 'Ink' : 'Cream';
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'cream' : 'ink'} theme`);
  };
  sync();

  button.addEventListener('click', () => {
    toggleTheme();
    sync();
  });
  onThemeChange(sync); // keep in sync if toggled elsewhere
  document.body.appendChild(button);
}
