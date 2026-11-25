import { toolBars } from '../tools/bars';
import { toolById, type Workspace } from '../tools/registry';

/**
 * The tool bar's notices: plain ones that go by themselves, and the one with
 * an Undo button. They sit where the menu notes do (the top of the view).
 */
function notice(text: string, ms: number, undo?: () => void): void {
  const el = document.createElement('div');
  el.className = 'sculpt-toast file-menu__note';
  el.setAttribute('role', 'status');
  el.dataset.role = 'tool-bar-note';
  const words = document.createElement('span');
  words.className = 'file-menu__words';
  words.textContent = text;
  el.appendChild(words);
  const timer = window.setTimeout(() => el.remove(), ms);
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-toast__btn';
    b.dataset.role = 'tool-bar-undo';
    b.textContent = 'Undo';
    b.addEventListener('click', () => {
      clearTimeout(timer);
      el.remove();
      undo();
    });
    el.appendChild(b);
  }
  document.body.appendChild(el);
}

/** Said once a visit when the order of a bar cannot be kept on this device. */
export function tellNotKept(): void {
  notice('Saving on this device is off, so the tool bar goes back to the default next time.', 6000);
}

/** View > Reset tool bar: the default order back on a workspace's bar, with a way back. */
export function resetToolBar(ws: Workspace): void {
  if (toolBars.isDefault(ws)) return;
  const was = toolBars.reset(ws);
  notice('Tool bar put back in its default order.', 8000, () => toolBars.set(ws, was));
}

/** A tool was taken off the tool bar (dragged off, or from its menu): it is still in the library, and Undo puts it back where it was. */
export function tellRemoved(name: string, undo: () => void): void {
  notice(`${name} is off the tool bar. It is still in the library.`, 8000, undo);
}

/** Take a tool off its workspace's bar from a menu: the same notice and Undo as dragging it off. */
export function removeFromBar(ws: Workspace, id: string): void {
  const was = [...toolBars.order(ws)];
  if (!was.includes(id)) return;
  toolBars.set(
    ws,
    was.filter((t) => t !== id),
  );
  tellRemoved(toolById(id)?.name ?? '', () => toolBars.set(ws, was));
}

/** A tool could not go on the bar: every place is taken. Said at most once every few seconds, since a lift that is refused may be tried again at once. */
let toldFullAt = -Infinity;
export function tellFull(): void {
  const now = performance.now();
  if (now - toldFullAt < 3000) return;
  toldFullAt = now;
  notice(`The tool bar is full (${toolBars.limit} tools). Take one off to add another.`, 6000);
}

/** Put a tool at the end of its workspace's bar from a menu; it stays in hand if it was. A full bar says so and takes nothing. */
export function addToBar(ws: Workspace, id: string): void {
  const was = [...toolBars.order(ws)];
  if (was.includes(id)) return;
  if (toolBars.isFull(ws)) {
    tellFull();
    return;
  }
  toolBars.set(ws, [...was, id]);
}
