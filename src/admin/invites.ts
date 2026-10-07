import { ApiError, ownerCall } from './api';
import { asOwner, failureSentence, ownerSignInPanel } from './ownerSession';
import { dayOf } from '../net/account';
import { Say, button, el } from '../ui/account/parts';

/**
 * The Invites tab (docs/accounts.md §8): make an invite link - a label for
 * the owner's own use, how many accounts it admits (1-500, one unless
 * said) and for how many days (1-90, fourteen unless said) - and see the
 * newest 500 with their uses, dates and state, each live one withdrawable.
 *
 * The link is shown once, as the server answers its making: only the
 * token's hash is kept, so nothing can show it again. It stays on the page
 * until the page is left, with a Copy button beside it.
 */

/** Where an invite stands (functions/_shared/auth/invites.ts): the first of revoked, used, expired that holds, else live. */
export type InviteState = 'live' | 'used' | 'expired' | 'revoked';

/** An invite as the owner's list shows it: never its token. */
export interface Invite {
  id: string;
  label: string;
  maxUses: number;
  uses: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  state: InviteState;
}

/** What a new invite may be asked to be, as the server holds it. */
export const INVITE_LIMITS = { maxUses: 500, defaultUses: 1, days: 90, defaultDays: 14, label: 100 } as const;

const ROOT = '/admin/api/invites';

export const invitesApi = {
  list: async (): Promise<Invite[]> => (await ownerCall<{ invites: Invite[] }>(ROOT)).invites,
  create: (input: { label: string; maxUses: number; expiresInDays: number }) =>
    ownerCall<{ invite: Invite; link: string }>(ROOT, 'POST', input),
  revoke: (id: string) => ownerCall<Invite>(`${ROOT}/${encodeURIComponent(id)}/revoke`, 'POST'),
};

const STATE_WORDS: Record<InviteState, string> = {
  live: 'Live',
  used: 'Used up',
  expired: 'Expired',
  revoked: 'Withdrawn',
};

/** A refusal from the invite routes, as a sentence. */
function refusalText(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = typeof err.body.reason === 'string' ? err.body.reason : '';
    if (err.code === 'bad_request' && reason === 'maxUses') return `An invite admits from 1 to ${INVITE_LIMITS.maxUses} accounts.`;
    if (err.code === 'bad_request' && reason === 'expiresInDays') return `An invite lasts from 1 to ${INVITE_LIMITS.days} days.`;
    if (err.code === 'bad_request' && reason === 'label') return `A label is at most ${INVITE_LIMITS.label} characters.`;
    if (err.code === 'not_found') return 'That invite is not there any more.';
    if (err.code === 'accounts_off') return 'Accounts are off on this site, so there are no invites.';
  }
  return failureSentence(err);
}

/** A whole number from 1 to `max` as typed, or null. */
function whole(raw: string, max: number): number | null {
  const n = /^\s*\d{1,4}\s*$/.test(raw) ? Number(raw) : NaN;
  return n >= 1 && n <= max ? n : null;
}

export async function renderInvites(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  const form = el('form', 'admin-create admin-invites__form');
  form.noValidate = true;
  const label = el('input');
  label.name = 'label';
  label.placeholder = 'Label, for you alone (optional)';
  label.maxLength = INVITE_LIMITS.label;
  label.autocomplete = 'off';
  const uses = number('maxUses', INVITE_LIMITS.defaultUses, INVITE_LIMITS.maxUses);
  const days = number('expiresInDays', INVITE_LIMITS.defaultDays, INVITE_LIMITS.days);
  const create = button('Create invite', 'btn btn--primary');
  create.type = 'submit';
  form.append(label, labelled('Accounts', uses), labelled('Days', days), create);
  const hint = el(
    'p',
    'admin__hint muted',
    `An invite link admits that many new accounts (1 to ${INVITE_LIMITS.maxUses}) for that many days (1 to ${INVITE_LIMITS.days}). ` +
      'The link is shown once, as it is made: copy it then.',
  );
  const say = new Say();
  const made = el('div', 'admin-invites__made');
  made.hidden = true;
  const list = el('div', 'admin-list admin-invites__list');
  host.append(form, hint, say.root, made, list);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void (async () => {
      const maxUses = whole(uses.value, INVITE_LIMITS.maxUses);
      const expiresInDays = whole(days.value, INVITE_LIMITS.days);
      if (maxUses === null) {
        say.error(`An invite admits from 1 to ${INVITE_LIMITS.maxUses} accounts.`);
        uses.focus();
        return;
      }
      if (expiresInDays === null) {
        say.error(`An invite lasts from 1 to ${INVITE_LIMITS.days} days.`);
        days.focus();
        return;
      }
      create.disabled = true;
      say.note('Making the invite…');
      try {
        const answer = await asOwner(() => invitesApi.create({ label: label.value.trim(), maxUses, expiresInDays }));
        if (!answer) {
          say.error('Not made: the owner tools need you signed in.');
          return;
        }
        say.clear();
        showLink(made, answer.link, answer.invite);
        label.value = '';
        await refresh(list);
      } catch (err) {
        say.error(refusalText(err));
      } finally {
        create.disabled = false;
      }
    })();
  });

  await refresh(list);
}

function number(name: string, value: number, max: number): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.name = name;
  i.min = '1';
  i.max = String(max);
  i.step = '1';
  i.value = String(value);
  i.inputMode = 'numeric';
  return i;
}

function labelled(text: string, input: HTMLInputElement): HTMLLabelElement {
  const l = el('label', 'admin-create__field');
  l.append(el('span', 'muted', text), input);
  return l;
}

/** The link the server answered with, shown this once, with Copy. */
function showLink(made: HTMLElement, link: string, invite: Invite): void {
  const field = el('input', 'admin-invites__link');
  field.readOnly = true;
  field.value = link;
  field.setAttribute('aria-label', 'Invite link');
  const copy = button('Copy', 'btn btn--primary');
  const said = el('span', 'muted admin-invites__copied');
  copy.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(link);
        said.textContent = 'Copied.';
      } catch {
        // No clipboard here (or it was refused): the link is selected to copy by hand.
        field.focus();
        field.select();
        said.textContent = 'Selected: copy it from the field.';
      }
    })();
  });
  const what = invite.label ? `“${invite.label}”` : 'The invite';
  const row = el('div', 'admin-invites__linkrow');
  row.append(field, copy, said);
  made.replaceChildren(
    el(
      'p',
      '',
      `${what} admits ${invite.maxUses === 1 ? 'one account' : `${invite.maxUses} accounts`} until ${dayOf(invite.expiresAt)}. ` +
        'This is the only time its link is shown: copy it now.',
    ),
    row,
  );
  made.hidden = false;
  field.focus();
  field.select();
}

async function refresh(list: HTMLElement): Promise<void> {
  list.replaceChildren(el('p', 'muted', 'Loading…'));
  let invites: Invite[] | null;
  try {
    invites = await asOwner(() => invitesApi.list(), true);
  } catch (err) {
    list.replaceChildren(el('p', 'muted', `The invites could not be loaded. ${refusalText(err)}`));
    return;
  }
  if (!invites) {
    list.replaceChildren(ownerSignInPanel(() => void refresh(list)));
    return;
  }
  if (!invites.length) {
    list.replaceChildren(el('p', 'admin__empty', 'No invites yet. Make one above.'));
    return;
  }
  list.replaceChildren(...invites.map((i) => inviteRow(i, list)));
}

function inviteRow(invite: Invite, list: HTMLElement): HTMLElement {
  const row = el('div', 'admin-row admin-invite');
  row.dataset.invite = invite.id;
  row.dataset.state = invite.state;
  const main = el('div', 'admin-row__main');
  main.append(el('span', 'admin-row__title', invite.label || 'Invite'), el('span', 'admin-row__meta', metaOf(invite)));
  const actions = el('div', 'admin-row__actions');
  const state = el('span', 'badge admin-invite__state', STATE_WORDS[invite.state]);
  actions.appendChild(state);
  const say = new Say();
  main.appendChild(say.root);
  if (invite.state === 'live') {
    const revoke = button('Revoke', 'btn btn--danger admin-invite__revoke');
    revoke.addEventListener('click', () => {
      const name = invite.label ? `“${invite.label}”` : 'this invite';
      if (!confirm(`Withdraw ${name}? Its link admits nobody from now on; accounts it already made stay.`)) return;
      void (async () => {
        revoke.disabled = true;
        try {
          const now = await asOwner(() => invitesApi.revoke(invite.id));
          if (!now) {
            say.error('Not withdrawn: the owner tools need you signed in.');
            revoke.disabled = false;
            return;
          }
          row.replaceWith(inviteRow(now, list));
        } catch (err) {
          say.error(refusalText(err));
          revoke.disabled = false;
        }
      })();
    });
    actions.appendChild(revoke);
  }
  row.append(main, actions);
  return row;
}

/** "1 of 2 used · made 7 October 2026 · until 21 October 2026", as it stands. */
function metaOf(i: Invite): string {
  const parts = [`${i.uses} of ${i.maxUses} used`, `made ${dayOf(i.createdAt)}`];
  if (i.state === 'revoked' && i.revokedAt !== null) parts.push(`withdrawn ${dayOf(i.revokedAt)}`);
  else parts.push(`${i.state === 'expired' ? 'ran out' : 'until'} ${dayOf(i.expiresAt)}`);
  return parts.join(' · ');
}
