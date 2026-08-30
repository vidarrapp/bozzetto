import { div } from '../../ui/dom';

/**
 * Inline "save to gallery" mini-form (WS5, admin only): a slug + title pair,
 * a go button, and a status line that walks through the upload sequence and
 * ends as a link to the published project. Hidden until the admin probe
 * confirms an Access session; guests never see it.
 */
export function galleryForm(opts: {
  buttonLabel: string;
  onSave: (id: string, title: string, progress: (text: string) => void) => Promise<string>;
}): { root: HTMLDivElement } {
  const root = div('gallery-form');
  root.hidden = true;

  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.placeholder = 'project-id';
  idInput.className = 'gallery-form__input';
  idInput.autocapitalize = 'off';
  idInput.spellcheck = false;

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Title (optional)';
  titleInput.className = 'gallery-form__input';

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'sculpt-panel__btn';
  go.textContent = opts.buttonLabel;

  const status = div('gallery-form__status');

  go.addEventListener('click', () => {
    const id = idInput.value.trim().toLowerCase();
    go.disabled = true;
    status.textContent = '';
    void opts
      .onSave(id, titleInput.value.trim(), (text) => {
        status.textContent = text;
      })
      .then((url) => {
        status.replaceChildren('Saved - ');
        const a = document.createElement('a');
        a.href = url;
        a.textContent = 'open it';
        a.target = '_blank';
        status.appendChild(a);
      })
      .catch((err: Error) => {
        status.textContent = err.message;
      })
      .finally(() => {
        go.disabled = false;
      });
  });

  root.append(idInput, titleInput, go, status);
  return { root };
}
