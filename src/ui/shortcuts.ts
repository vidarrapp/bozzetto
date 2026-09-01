import type { Viewer } from '../viewer/Viewer';
import { isFormControlTarget, isTextEntryTarget, tabShouldMoveFocus } from './dom';

export interface ShortcutHandlers {
  /** Toggle the side panel open/closed (Tab). */
  togglePanel?: () => void;
  /** Toggle the hotkey guide overlay (H). */
  toggleHelp?: () => void;
  /** Toggle the FPS meter (secret hotkey T). */
  toggleFps?: () => void;
  /** Called after a command that changes panel-reflected state, to re-sync it. */
  refresh?: () => void;
}

/**
 * Global keyboard shortcuts, shared by the viewer and the editor preview:
 *   space      play / pause            ← / a · → / d   step
 *   f          focus (frame model)     r              reset view
 *   s          smooth ↔ flat shading   w              wireframe overlay
 *   g          ground shadow
 *   1          Lit (PBR)               2..n           matcaps (interface order)
 *   dbl-click  set focus point (tap-to-focus; double-tap on touch)
 *   tab        toggle side panel       h              hotkey guide
 * Returns a disposer that detaches the listener.
 */
export function installShortcuts(viewer: Viewer, handlers: ShortcutHandlers = {}): () => void {
  const onKey = (e: KeyboardEvent): void => {
    // Every binding here is a plain key, and plain keys on a focused form
    // control (space on a checkbox, arrows on a slider) belong to it.
    if (isTextEntryTarget(e) || isFormControlTarget(e)) return;
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
      case 'g':
        viewer.cycleGround();
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
        // Shift+Tab, and Tab from anything focusable, belong to the browser:
        // this used to swallow both, killing backward traversal everywhere
        // and stranding anyone who tabbed onto a button.
        if (tabShouldMoveFocus(e)) return;
        e.preventDefault();
        handlers.togglePanel?.();
        return;
      case 'h':
      case 'H':
        handlers.toggleHelp?.();
        return;
      case 't':
        handlers.toggleFps?.();
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
