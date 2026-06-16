import type { Viewer } from '../viewer/Viewer';

/**
 * Global keyboard shortcuts, shared by the viewer and the editor preview:
 *   space      play / pause
 *   ← / a      step back        → / d   step forward
 *   w          toggle wireframe overlay
 *   r          reset view       g       toggle ground shadow
 *   1..n       material mode
 * Returns a disposer that detaches the listener.
 */
export function installShortcuts(viewer: Viewer): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        viewer.togglePlay();
        break;
      case 'ArrowRight':
      case 'd':
        viewer.step(1);
        break;
      case 'ArrowLeft':
      case 'a':
        viewer.step(-1);
        break;
      case 'w':
        viewer.toggleWireframe();
        break;
      case 'r':
        viewer.resetView();
        break;
      case 'g':
        viewer.setGround(!viewer.isGroundEnabled());
        break;
      default: {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= viewer.materials.modes.length) {
          viewer.setMaterial(viewer.materials.modes[n - 1].id);
        }
      }
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
