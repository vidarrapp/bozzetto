import { toolBars } from '../tools/bars';
import type { Workspace } from '../tools/registry';

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
