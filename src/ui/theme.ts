/**
 * App-wide theme. The application layer is dark only (docs/ui-foundations.md):
 * `data-theme` on <html> is always `dark`, whatever an earlier visit stored.
 * Call initTheme() before first paint. The functions that used to switch to
 * paper stay as harmless stand-ins so their callers keep working.
 */

export type Theme = 'dark' | 'light';

/**
 * The viewer's 3D background: the same grey as Sculpt's and Armature's
 * (STUDIO_BG). The scene's background brightness dims it, so #333333 is
 * what draws as the interface's viewport grey, #222222.
 */
export const THEME_BG: Record<Theme, string> = {
  dark: '#333333',
  light: '#333333',
};

/** The browser chrome's colour: the title strip. */
const CHROME_COLOR = '#1b1b1b';

export function initTheme(): Theme {
  document.documentElement.dataset.theme = 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR);
  return 'dark';
}

export function getTheme(): Theme {
  return 'dark';
}

/** There is one theme: asking for another changes nothing. */
export function setTheme(_theme: Theme): void {
  initTheme();
}

export function toggleTheme(): Theme {
  return 'dark';
}

/** Subscribe to theme changes; the theme never changes, so this only hands back an unsubscribe. */
export function onThemeChange(_cb: (theme: Theme) => void): () => void {
  return () => {};
}

/** The ink/paper chip is gone with the paper theme; kept so pages need no change. */
export function mountThemeToggle(): void {}
