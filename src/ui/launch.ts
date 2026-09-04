/**
 * How Bozzetto was opened: from a home-screen/desktop install, or as a page
 * on the site.
 *
 * The obvious check - matchMedia('(display-mode: standalone)') - is wrong
 * here. display-mode values are distinct, not a ladder, and the manifest
 * asks for `fullscreen`; browsers disagree about whether the standalone
 * query also matches a fullscreen app. On iPadOS the pre-standard
 * navigator.standalone flag covered that up, so the bug only showed on
 * Android, where an installed app could still be told to install itself.
 * Every installed mode is therefore named explicitly, and an unknown query
 * simply does not match rather than being read as a yes.
 */

const INSTALLED_MODES = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'];

/** The display mode in force, or null when running as an ordinary page. */
export function installedMode(): string | null {
  // iOS Safari's pre-standard flag, still what iPadOS sets on a home-screen
  // launch, and set there before display-mode was supported at all.
  if ((navigator as { standalone?: boolean }).standalone === true) return 'standalone';
  try {
    return INSTALLED_MODES.find((m) => window.matchMedia(`(display-mode: ${m})`).matches) ?? null;
  } catch {
    return null;
  }
}

/** True when launched from an installed icon rather than a browser tab. */
export function isInstalled(): boolean {
  return installedMode() !== null;
}

/** One line for a debug readout: how it was opened, and whether it can run offline. */
export function launchSummary(): string {
  const mode = installedMode();
  const worker =
    'serviceWorker' in navigator && navigator.serviceWorker.controller ? 'cached' : 'network';
  return `${mode ? `installed (${mode})` : 'browser'} · ${worker}`;
}
