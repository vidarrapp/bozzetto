/**
 * "Install" chip + instructions: Bozzetto ships a web-app manifest and
 * home-screen icons, but nothing ever told a visitor the app is
 * installable - and on iPadOS there is no install prompt to lean on, only
 * Safari's buried Add to Home Screen. The chip opens a short card with
 * the steps. Hidden when already running installed (standalone display
 * mode), where the instructions would be noise.
 */

import { topChip } from './topbar';
import { desktopDownloads } from './desktopDownloads';
import { isInstalled } from './launch';

/** The iOS share glyph, so "the Share button" is recognisable at a glance. */
const SHARE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3v12" /><path d="M8 6l4 -3.5 4 3.5" />' +
  '<path d="M7 10h-2v10h14v-10h-2" /></svg>';

/** The top-row chip, or null when already installed. */
export function installChip(): HTMLElement | null {
  if (isInstalled()) return null;
  const chip = topChip('Install');
  chip.addEventListener('click', () => openInstallCard());
  return chip;
}

function openInstallCard(): void {
  const overlay = document.createElement('div');
  overlay.className = 'install-overlay';
  overlay.innerHTML = `
    <div class="install-card" role="dialog" aria-modal="true" aria-label="Install Bozzetto">
      <button type="button" class="install-close" aria-label="Close">×</button>
      <h2>Put Bozzetto on your Home Screen</h2>
      <p class="muted">On an iPad (or iPhone), in Safari:</p>
      <ol class="install-steps">
        <li>Open <strong>bozzetto.vidarrapp.se</strong> in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button ${SHARE_SVG} in the toolbar
            (top right on iPad, bottom on iPhone).</li>
        <li>Scroll the sheet and choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>.</li>
      </ol>
      <p class="muted">Bozzetto then launches fullscreen from its own icon,
        like any app. On Android, Chrome offers the same under
        <strong>Add to Home screen</strong> in its menu.</p>
    </div>`;
  // Downloads go in after the home-screen steps, and fetch on open rather
  // than on page load: the rest of the app makes no requests, and this
  // should not quietly become the exception.
  const downloads = desktopDownloads();
  if (downloads) overlay.querySelector('.install-card')?.appendChild(downloads);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // the backdrop, not the card
  });
  overlay.querySelector('.install-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
