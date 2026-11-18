import { div } from '../../ui/dom';
import type { SculptSession } from '../bridge/SculptSession';

/**
 * The Layers panels' line for an object with dynamic topology on, which
 * cannot have layers: the sentence, and a plain button that turns it off for
 * the active object, as the Model panel's switch does (one undo step; the
 * object's shape and colours stay, and it is made of triangles). The panels
 * show and hide it with `hidden`.
 */
export function dynamicNote(session: SculptSession, sentence: string, after: () => void): HTMLDivElement {
  const note = div('layers-note');
  note.hidden = true;
  const words = document.createElement('span');
  words.textContent = sentence;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn layers-note__btn';
  button.textContent = 'Turn off dynamic topology';
  button.addEventListener('click', () => {
    if (!session.getMesh()?.isDynamic) return;
    session.toggleDynamicTopology();
    after();
  });
  note.append(words, button);
  return note;
}
