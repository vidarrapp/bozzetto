import { getTheme } from './theme';

/**
 * Sculpt-mode boot splash: the handwritten Bozzetto logo drawing itself
 * (a 2.5s silent mp4, ~120 KB), played inside the existing boot overlay
 * while the engine mounts, so the wait IS the branding. The overlay's
 * status line keeps reporting under it. Two variants, one per theme -
 * their backgrounds are the design system's warm ink (#1c1814) and paper
 * (#f1ebe1), i.e. exactly the overlay's var(--bg), so the 16:9 frame
 * melts into the full-bleed overlay with no seam.
 *
 * The rules, in order of importance:
 *  - it must never WEDGE the boot: any playback failure (404, decode,
 *    autoplay refusal) and a hard time cap all resolve `finished`;
 *  - a tap skips it (second launches shouldn't cost 2.5s of patience);
 *  - reduced-motion users keep the plain overlay - no video mounts at all.
 *
 * The caller still owns the overlay: it awaits `finished` alongside its own
 * mount work and then fades/removes the overlay itself (see bootSculpt).
 */
export interface SculptSplash {
  /** Resolves when the animation has said its piece (ended/skipped/failed). */
  finished: Promise<void>;
  /** Put the overlay back the way it was (error path re-uses it for text). */
  dispose(): void;
}

/** How long the splash may hold the overlay at most, from mount. */
const SPLASH_CAP_MS = 4000;

export function mountSculptSplash(overlay: HTMLElement | null): SculptSplash {
  if (!overlay || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { finished: Promise.resolve(), dispose: () => {} };
  }

  overlay.classList.add('overlay--splash');
  const video = document.createElement('video');
  video.className = 'overlay__splash-video';
  video.muted = true; // muted + inline is what lets mobile Safari autoplay
  video.playsInline = true;
  video.autoplay = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true'); // decorative; the status line speaks
  const variant = getTheme() === 'light' ? 'paper' : 'ink';
  // One src picked up front, not <source> children: when every <source>
  // candidate fails the error lands on the source elements and the video
  // just waits, which would leave only the time cap to release the boot.
  // H.264 first (Safari, and hardware decode everywhere it exists); the
  // VP9 WebM covers codec-free Chromium builds.
  const ext = video.canPlayType('video/mp4; codecs="avc1.42E01E"') ? 'mp4' : 'webm';
  video.src = `${import.meta.env.BASE_URL}assets/bozzetto-splash-${variant}.${ext}`;
  // Before the status line, so the grid stacks logo over message.
  overlay.prepend(video);

  let timer = 0;
  let settle: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = () => {
      window.clearTimeout(timer);
      overlay.removeEventListener('pointerdown', settle);
      resolve(); // resolving twice is a no-op, so the paths need no flags
    };
    video.addEventListener('ended', settle);
    video.addEventListener('error', settle);
    // A tap anywhere skips - the video itself is pointer-transparent.
    overlay.addEventListener('pointerdown', settle);
    timer = window.setTimeout(settle, SPLASH_CAP_MS);
    // Muted inline autoplay is allowed everywhere that matters, but a
    // refusal must degrade to the plain overlay, not a frozen frame.
    video.play().catch(() => settle());
  });

  return {
    finished,
    dispose: () => {
      settle();
      video.remove();
      overlay.classList.remove('overlay--splash');
    },
  };
}
