import Enums from '@sculpt-vendor/misc/Enums';
import type { SculptSession } from './SculptSession';

/**
 * Ported from SculptGL.js's onDeviceDown/Move/Up state machine (plan 6.3),
 * reduced to the WS0 spike surface: left-drag on the mesh sculpts, everything
 * else falls through to Bozzetto's OrbitControls (the only camera).
 *
 * Arbitration mirrors the tap-to-focus pattern: listeners sit on the viewer
 * container in the capture phase, ahead of OrbitControls' canvas handlers. A
 * pointer-down that hits the mesh starts a stroke and swallows the event so
 * no orbit begins; a miss (or Alt, or a non-primary button) is left alone and
 * orbits/pans/dollies exactly as in the viewer.
 *
 * WS0 hardcoded keys: 1 Brush, 2 Smooth, 3 Drag (the 1-9 digits are reserved
 * for brushes in sculpt mode by decision; the full table lands in WS4).
 */
export class InputShell {
  private pointerId = -1;

  constructor(
    private readonly session: SculptSession,
    private readonly container: HTMLElement,
  ) {}

  install(): void {
    this.container.addEventListener('pointerdown', this.onPointerDown, true);
    this.container.addEventListener('pointermove', this.onPointerMove, true);
    this.container.addEventListener('pointerup', this.onPointerUp, true);
    this.container.addEventListener('pointercancel', this.onPointerUp, true);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  dispose(): void {
    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    this.container.removeEventListener('pointermove', this.onPointerMove, true);
    this.container.removeEventListener('pointerup', this.onPointerUp, true);
    this.container.removeEventListener('pointercancel', this.onPointerUp, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  /** Mirror upstream setMousePosition: device pixels relative to the canvas. */
  private setMouse(e: PointerEvent): void {
    const s = this.session;
    const canvas = s.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const ratio = s.getPixelRatio();
    s._mouseX = (e.clientX - rect.left) * ratio;
    s._mouseY = (e.clientY - rect.top) * ratio;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    // Alt and non-primary buttons stay with OrbitControls, as does a miss.
    if (e.button !== 0 || e.altKey) return;
    const s = this.session;
    this.setMouse(e);

    const canEdit = s.getSculptManager().start(e.shiftKey);
    if (!canEdit) {
      s._action = Enums.Action.NOTHING;
      return; // no hit: the event continues on to OrbitControls (orbit)
    }

    s._action = Enums.Action.SCULPT_EDIT;
    this.pointerId = e.pointerId;
    s.getCanvas().setPointerCapture(e.pointerId);
    s.setCanvasCursor('none');
    e.preventDefault();
    e.stopPropagation();
    s._lastMouseX = s._mouseX;
    s._lastMouseY = s._mouseY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const s = this.session;
    if (s._action !== Enums.Action.SCULPT_EDIT || e.pointerId !== this.pointerId) return;
    this.setMouse(e);
    e.preventDefault();
    e.stopPropagation();

    // Upstream onDeviceMove, sculpt branch: refresh picking, then stroke.
    s.getSculptManager().preUpdate();
    s.getSculptManager().update();

    s._lastMouseX = s._mouseX;
    s._lastMouseY = s._mouseY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const s = this.session;
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;

    if (s._action === Enums.Action.SCULPT_EDIT) {
      // Upstream onDeviceUp: octree rebalance + drop no-op undo entries.
      s.getSculptManager().end();
      s.getStateManager().cleanNoop();
      s.setCanvasCursor('default');
      e.stopPropagation();
    }
    s._action = Enums.Action.NOTHING;
    s.render();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    const tools = Enums.Tools;
    const byKey: Record<string, number> = { 1: tools.BRUSH, 2: tools.SMOOTH, 3: tools.DRAG };
    const tool = byKey[e.key];
    if (tool === undefined) return;
    this.session.getSculptManager().setToolIndex(tool);
    // In sculpt mode the digits belong to brushes; keep the viewer's
    // material-preset bindings (bubble phase) from also firing.
    e.stopPropagation();
  };
}
