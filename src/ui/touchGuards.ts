import { isTextField } from './dom';

/**
 * What the browser and the OS may not start from the app's own surface.
 * The app is a drawing tool on an iPad first, and each of these, fired by
 * a resting hand or a held Pencil, stole the interaction or put something
 * over the work:
 *
 * - the context menu (a right click, or a trackpad or mouse on an iPad),
 *   everywhere but text fields, selectable error text and links;
 * - Safari's own pinch gesture events, which zoom the page - the belt to
 *   the braces of `touch-action` on the root (style.css);
 * - an image dragged out of the app, which on iPadOS lifts it for drag and
 *   drop and offers it to other apps;
 * - a text field left focused while the work goes on elsewhere: its
 *   on-screen keyboard, and the dictation key on it, stay up until the
 *   focus goes, and on iOS a press on something unfocusable never takes it
 *   (the canvas also cancels its touches' defaults, which is what moves
 *   focus). A press anywhere outside the field now blurs it.
 *
 * The long-press callout, the loupe and text selection are CSS (style.css);
 * the canvas cancels its own touchstart (Viewer), and so do the controls
 * that are held rather than tapped.
 */
export function installTouchGuards(): void {
  document.addEventListener('contextmenu', (e) => {
    if (keepsNativeMenu(e.target)) return;
    e.preventDefault();
  });
  // Safari-only events; elsewhere they never fire.
  for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('dragstart', (e) => {
    if (e.target instanceof HTMLImageElement) e.preventDefault();
  });
  document.addEventListener(
    'pointerdown',
    (e) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isTextField(focused) && !focused.contains(e.target as Node)) {
        focused.blur();
      }
    },
    true,
  );
}

/** Where the native menu is worth having: cut and paste, copying an error, a link. */
function keepsNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isTextField(target)) return true;
  return !!target.closest('.overlay--error, a[href]');
}
