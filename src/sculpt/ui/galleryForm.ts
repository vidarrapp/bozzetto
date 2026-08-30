import { div } from '../../ui/dom';

/**
 * Inline "save to gallery" mini-form: a slug + title pair, a go button, and
 * a status line that walks through the upload sequence and ends as a link to
 * the published project. The fields appear once the admin probe confirms a
 * Cloudflare Access session; without one there is a single line saying so,
 * which re-checks when tapped - the form used to be hidden outright, which
 * made a failed probe look identical to a feature that did not exist.
 */
export function galleryForm(opts: {
  buttonLabel: string;
  onSave: (id: string, title: string, progress: (text: string) => void) => Promise<string>;
  /** Re-run the admin check; resolves to the email, or null for a guest. */
  recheck: () => Promise<string | null>;
}): { root: HTMLDivElement; setAdmin: (isAdmin: boolean) => void } {
  const root = div('gallery-form');
  root.hidden = true;

  // Guests get one line rather than nothing. Hiding the whole thing made a
  // failed admin probe indistinguishable from "this feature does not
  // exist", which is exactly how it read when the sign-in was live but the
  // probe still said guest - so the line re-checks on tap and says what it
  // found either way.
  const gate = div('gallery-form__gate');
  const gateBtn = document.createElement('button');
  gateBtn.type = 'button';
  gateBtn.className = 'sculpt-panel__btn';
  gateBtn.textContent = 'Publish to gallery...';
  // Its own class, not the status line's: two elements sharing one class
  // inside the same form made every "did it save?" selector ambiguous.
  const gateNote = div('gallery-form__gatenote');
  gateNote.textContent = 'Needs the admin sign-in.';
  gate.append(gateBtn, gateNote);
  gateBtn.addEventListener('click', () => {
    gateBtn.disabled = true;
    gateNote.textContent = 'Checking sign-in...';
    void opts
      .recheck()
      .then((email) => {
        if (email) {
          setAdmin(true);
          return;
        }
        gateNote.replaceChildren('Not signed in - open ');
        const a = document.createElement('a');
        a.href = '/admin/';
        a.textContent = '/admin/';
        a.target = '_blank';
        gateNote.append(a, ', then re-check.');
      })
      .finally(() => {
        gateBtn.disabled = false;
      });
  });

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

  const fields = div('gallery-form__fields');
  fields.append(idInput, titleInput, go, status);
  fields.hidden = true;

  const setAdmin = (isAdmin: boolean): void => {
    root.hidden = false;
    gate.hidden = isAdmin;
    fields.hidden = !isAdmin;
  };

  root.append(gate, fields);
  return { root, setAdmin };
}
