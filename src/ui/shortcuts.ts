import type { Viewer } from '../viewer/Viewer';
import { isFormControlTarget, isTextEntryTarget, tabShouldMoveFocus } from './dom';
import { keymap } from './keymap';
import { showPreferences } from './Preferences';

export interface ShortcutHandlers {
  /** Toggle the side panel open/closed (Tab). */
  togglePanel?: () => void;
  /** Toggle the hotkey guide overlay (H). */
  toggleHelp?: () => void;
  /** Toggle the FPS meter (P). */
  toggleFps?: () => void;
  /** Called after a command that changes panel-reflected state, to re-sync it. */
  refresh?: () => void;
}

/**
 * Global keyboard shortcuts, shared by the viewer and the editor preview,
 * and underneath sculpt mode for whatever its shell leaves unclaimed (the
 * guide, the frame-rate meter, the ground). The keys live in the keymap
 * (src/ui/keymap.ts), which Preferences edits; this only says what each
 * action does. Returns a disposer that detaches the listener.
 */
export function installShortcuts(viewer: Viewer, handlers: ShortcutHandlers = {}): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (document.body.classList.contains('has-modal')) return;
    // Plain keys on a focused form control (space on a checkbox, arrows on
    // a slider) belong to it; chords still reach here.
    if (isTextEntryTarget(e)) return;
    if (isFormControlTarget(e) && !e.ctrlKey && !e.metaKey) return;
    const action = keymap.actionFor(e, 'view');
    if (!action) return;
    if (e.repeat && !action.repeat) return;

    switch (action.id) {
      case 'play.toggle':
        e.preventDefault();
        viewer.togglePlay();
        return;
      case 'play.forward':
        viewer.step(1);
        return;
      case 'play.back':
        viewer.step(-1);
        return;
      case 'view.frame':
      case 'view.frameAll':
        // A viewer project is a single subject, so framing everything and
        // framing the selection land in the same place - the key still
        // means what it means in sculpt mode.
        viewer.focusSubject();
        return;
      case 'view.ground':
        viewer.cycleGround();
        handlers.refresh?.();
        return;
      case 'view.wireframe':
        viewer.toggleWireframe();
        handlers.refresh?.();
        return;
      case 'view.shadows':
        viewer.lighting.setShadowsMaster(!viewer.lighting.getShadowsMaster());
        handlers.refresh?.();
        return;
      case 'ui.panel':
        // Shift+Tab, and Tab from anything focusable, belong to the browser:
        // this used to swallow both, killing backward traversal everywhere
        // and stranding anyone who tabbed onto a button.
        if (e.key === 'Tab' && tabShouldMoveFocus(e)) return;
        e.preventDefault();
        handlers.togglePanel?.();
        return;
      case 'ui.help':
        handlers.toggleHelp?.();
        return;
      case 'ui.fps':
        handlers.toggleFps?.();
        return;
      case 'ui.preferences':
        e.preventDefault();
        showPreferences();
        return;
      case 'material.lit':
        viewer.setMaterial('lit');
        handlers.refresh?.();
        return;
      default:
        break;
    }

    // Matcaps in interface order: material.matcap1 .. matcap8.
    const m = /^material\.matcap(\d)$/.exec(action.id);
    if (m) {
      const index = Number(m[1]) - 1;
      if (index < viewer.materials.matcaps().length) {
        viewer.setMaterial('matcap');
        viewer.materials.setMatcapIndex(index);
        handlers.refresh?.();
      }
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
