import type { Viewer } from '../viewer/Viewer';

export interface ShortcutHandlers {
  /** Toggle the side panel open/closed (Tab). */
  togglePanel?: () => void;
  /** Toggle the hotkey guide overlay (H). */
  toggleHelp?: () => void;
  /** Called after a command that changes panel-reflected state, to re-sync it. */
  refresh?: () => void;
}

/**
 * Global keyboard shortcuts, shared by the viewer and the editor preview:
 *   space      play / pause            ← / a · → / d   step
 *   f          focus (frame model)     r              reset view
 *   s          smooth ↔ flat shading   w              wireframe overlay
 *   g          ground shadow           1              Lit (PBR)
 *   2..n       matcaps (interface order)
 *   tab        toggle side panel       h              hotkey guide
 * Returns a disposer that detaches the listener.
 */
export function installShortcuts(viewer: Viewer, handlers: ShortcutHandlers = {}): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        viewer.togglePlay();
        return;
      case 'ArrowRight':
      case 'd':
        viewer.step(1);
        return;
      case 'ArrowLeft':
      case 'a':
        viewer.step(-1);
        return;
      case 'f':
        viewer.focusSubject();
        return;
      case 'r':
        viewer.resetView();
        return;
      case 'g':
        viewer.setGround(!viewer.isGroundEnabled());
        handlers.refresh?.();
        return;
      case 'w':
        viewer.toggleWireframe();
        handlers.refresh?.();
        return;
      case 's':
        viewer.materials.toggleFlatShading();
        handlers.refresh?.();
        return;
      case 'Tab':
        e.preventDefault();
        handlers.togglePanel?.();
        return;
      case 'h':
      case 'H':
        handlers.toggleHelp?.();
        return;
      default:
        break;
    }

    // Material: 1 = Lit (PBR); 2..(1+N) = matcaps in interface order.
    const n = Number(e.key);
    if (!Number.isInteger(n)) return;
    if (n === 1) {
      viewer.setMaterial('lit');
      handlers.refresh?.();
    } else if (n >= 2 && n - 2 < viewer.materials.matcaps().length) {
      viewer.setMaterial('matcap');
      viewer.materials.setMatcapIndex(n - 2);
      handlers.refresh?.();
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
