import { div } from '../../ui/dom';
import { AuthExpiredError, type Role, type Visibility } from '../../admin/api';
import { isDesktop } from '../../net/origin';
import { signInButton } from '../../ui/signIn';

/**
 * Inline "save to gallery" mini-form: a slug + title pair, who may see it,
 * a go button, and a status line that walks through the upload sequence
 * and ends as a link to the published project. The fields appear once the
 * admin probe confirms a Cloudflare Access session; without one there is a
 * single line saying so, which re-checks when tapped - the form used to be
 * hidden outright, which made a failed probe look identical to a feature
 * that did not exist. When the session has expired, or a publish finds
 * that it has, the line says so and offers Sign in again, which comes back
 * to this page with the work on it.
 */
export function galleryForm(opts: {
  buttonLabel: string;
  onSave: (
    id: string,
    title: string,
    visibility: Visibility,
    progress: (text: string) => void,
  ) => Promise<string>;
  /** Re-run the admin check; resolves to the email, or null for a guest. */
  recheck: () => Promise<string | null>;
}): { root: HTMLDivElement; setRole: (role: Role) => void } {
  const root = div('gallery-form');
  root.hidden = true;
  /** The role the form was last told; null before the probe's first answer. */
  let role: Role | null = null;

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
  // After the re-check button, so a tap on the gate's first button is
  // still the re-check. A desktop sign-in that ended well checks again.
  const signIn = signInButton('sculpt-panel__btn gallery-form__signin', (ok) => {
    if (ok) void opts.recheck();
  });
  signIn.hidden = true;
  gate.append(gateBtn, gateNote, signIn);
  /** The gate's line, and whether it offers a way to sign in from here. */
  const sayGate = (text: string, offer: boolean, label = 'Sign in again'): void => {
    gateNote.textContent = text;
    signIn.textContent = label;
    signIn.hidden = !offer;
  };
  gateBtn.addEventListener('click', () => {
    gateBtn.disabled = true;
    gateNote.textContent = 'Checking sign-in...';
    void opts
      .recheck()
      .then((email) => {
        // The re-check set the role and its words; a guest is told how to
        // sign in, since that is what was asked. Not in another tab: an
        // installed app cannot reach one (it keeps cookies of its own), so
        // the page is left and come back to, with the work kept. The
        // desktop app signs in from its Server menu.
        if (email || role !== 'guest') return;
        if (isDesktop()) sayGate('Not signed in: Server > Sign In.', false);
        else sayGate('Not signed in.', true, 'Sign in');
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

  // Public, as publishing has always been, unless chosen otherwise. A
  // private project shows in the owner's gallery and editor only.
  const visibility = document.createElement('select');
  visibility.className = 'gallery-form__input gallery-form__visibility';
  visibility.setAttribute('aria-label', 'Who can see it');
  for (const [value, label] of [
    ['public', 'Public: in the gallery'],
    ['private', 'Private: only you'],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    visibility.appendChild(o);
  }
  visibility.value = 'public';

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
      .onSave(id, titleInput.value.trim(), visibility.value === 'private' ? 'private' : 'public', (text) => {
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
        // Publishing has nothing to fall back on: the frames and the scene
        // stay where they are, and it goes again once signed in.
        if (err instanceof AuthExpiredError) {
          status.replaceChildren('Your sign-in has expired, so publishing stopped.');
          status.appendChild(
            signInButton('sculpt-panel__btn gallery-form__signin', (ok) => {
              if (ok) void opts.recheck();
            }),
          );
          return;
        }
        status.textContent = err.message;
      })
      .finally(() => {
        go.disabled = false;
      });
  });

  const fields = div('gallery-form__fields');
  fields.append(idInput, titleInput, visibility, go, status);
  fields.hidden = true;

  const setRole = (next: Role): void => {
    role = next;
    root.hidden = false;
    gate.hidden = next === 'owner';
    fields.hidden = next !== 'owner';
    if (next === 'expired') sayGate('Your sign-in has expired.', true);
    else if (next === 'guest') sayGate('Needs the admin sign-in.', false);
  };

  root.append(gate, fields);
  return { root, setRole };
}
