import type { Viewer } from '../viewer/Viewer';
import { isFormControlTarget, isTextEntryTarget, tabShouldMoveFocus } from './dom';
import { keymap } from './keymap';
import { KEY_DRAG_DEG_PER_PX } from '../viewer/Lighting';
import { showPreferences } from './Preferences';

export interface ShortcutHandlers {
  /** Tab: close the open panels, then hide the interface, then bring it back (ChromeToggle.handleTab). */
  toggleChrome?: () => void;
  /** Toggle the hotkey guide overlay (H). */
  toggleHelp?: () => void;
  /** Toggle the frame meter (P), which remembers the choice. */
  toggleFps?: () => void;
  /** Called after a command that changes panel-reflected state, to re-sync it. */
  refresh?: () => void;
}

/**
 * Global keyboard shortcuts, shared by the viewer and the editor preview,
 * and underneath sculpt mode for whatever its shell leaves unclaimed (the
 * guide, the frame meter, the ground). The keys live in the keymap
 * (src/ui/keymap.ts), which Preferences edits; this only says what each
 * action does. Returns a disposer that detaches the listener.
 */
export function installShortcuts(viewer: Viewer, handlers: ShortcutHandlers = {}): () => void {
  // --- hold L: the key light ------------------------------------------------
  /**
   * Hold L and move the pointer, as in Sculpt and Armature: across swings
   * the key light around the subject, up and down raises and lowers it,
   * half a degree a pixel (Lighting.nudgeKey). While it is held a press on
   * the view is the light's alone - it orbits nothing and sets no focus -
   * so these listen on the window in the capture phase, ahead of the
   * orbit controls on the canvas and the viewer's own tap handling.
   */
  let lightHeld = false;
  const last = { x: NaN, y: NaN };
  let refreshTimer = 0;
  const view = (): HTMLElement => viewer.renderer.domElement.parentElement ?? viewer.renderer.domElement;
  const onView = (e: Event): boolean => e.target instanceof Node && view().contains(e.target);
  const endLight = (): void => {
    lightHeld = false;
  };
  const onLightMove = (e: PointerEvent): void => {
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
    if (!lightHeld) return;
    if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
      viewer.lighting.nudgeKey(dx * KEY_DRAG_DEG_PER_PX, -dy * KEY_DRAG_DEG_PER_PX);
      viewer.invalidate();
      // The panel's azimuth and elevation rows read their values when they
      // are built: one refresh once the drag settles, as Armature does.
      clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => handlers.refresh?.(), 250);
    }
    if (onView(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const onLightPress = (e: PointerEvent): void => {
    if (!lightHeld || !onView(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    // A held key ends on its own key, whatever the modifiers are doing now.
    if (keymap.holdActionForKeyUp(e, 'view')?.id === 'view.light') endLight();
  };

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
      case 'ui.chrome':
        // Shift+Tab, and Tab from anything focusable, belong to the browser:
        // this used to swallow both, killing backward traversal everywhere
        // and stranding anyone who tabbed onto a button.
        if (e.key === 'Tab' && tabShouldMoveFocus(e)) return;
        e.preventDefault();
        handlers.toggleChrome?.();
        return;
      case 'ui.show':
        // The toggle listens for its own way back (ChromeToggle), the same
        // in every mode; nothing more to do here.
        return;
      case 'view.light':
        e.preventDefault();
        lightHeld = true; // until its keyup, or the window losing focus
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
  window.addEventListener('keyup', onKeyUp);
  // Losing the window eats the keyup (an app switch with L down): without
  // this every press after it would still go to the light.
  window.addEventListener('blur', endLight);
  window.addEventListener('pointermove', onLightMove, true);
  window.addEventListener('pointerdown', onLightPress, true);
  return () => {
    clearTimeout(refreshTimer);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', endLight);
    window.removeEventListener('pointermove', onLightMove, true);
    window.removeEventListener('pointerdown', onLightPress, true);
  };
}
