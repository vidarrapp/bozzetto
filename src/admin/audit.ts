import { ApiError, ownerCall } from './api';
import { asOwner, failureSentence, ownerSignInPanel } from './ownerSession';
import { momentOf } from '../net/account';
import { Say, button, el } from '../ui/account/parts';

/**
 * The Audit tab (docs/accounts.md §8): the log of what was done to
 * accounts and projects, newest first, 50 a page, filtered by an action -
 * the actions the log holds, from the server - and by a subject, an
 * account's or a project's id (a row's subject, pressed, filters by it).
 * Nothing past twelve months is there: the server lets those rows go as
 * the log is read. The filter rides the address, so a reload keeps it.
 */

/** A row as the log keeps it: who acted, what they did, to what, and the particulars (ids, counts, flags). */
export interface AuditRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  subject: string | null;
  detail: Record<string, unknown>;
}

export interface AuditFilter {
  action: string;
  subject: string;
}

export const auditApi = {
  page: (filter: AuditFilter, before: string | null) => {
    const q = new URLSearchParams();
    if (before) q.set('before', before);
    if (filter.action) q.set('action', filter.action);
    if (filter.subject) q.set('subject', filter.subject);
    const query = q.toString();
    return ownerCall<{ rows: AuditRow[]; next: string | null; actions: string[] }>(`/admin/api/audit${query ? `?${query}` : ''}`);
  },
};

/** The most a filter may be, in characters (functions/admin/api/audit MAX_FILTER). */
const MAX_FILTER = 128;

function refusalText(err: unknown): string {
  if (err instanceof ApiError && err.code === 'bad_request') {
    if (err.body.reason === 'subject' || err.body.reason === 'action') return `A filter is at most ${MAX_FILTER} characters.`;
  }
  return failureSentence(err);
}

/** The particulars, as `key value` pairs: "from 262144000 · to 524288000". */
function detailText(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}

interface State {
  filter: AuditFilter;
  next: string | null;
  list: HTMLElement;
  more: HTMLButtonElement;
  actions: HTMLSelectElement;
  subject: HTMLInputElement;
  clear: HTMLButtonElement;
  say: Say;
}

export async function renderAudit(host: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const filter: AuditFilter = {
    action: (params.get('action') ?? '').slice(0, MAX_FILTER),
    subject: (params.get('subject') ?? '').trim().slice(0, MAX_FILTER),
  };
  const form = el('form', 'admin-create admin-audit__filter');
  form.noValidate = true;
  const actions = el('select', 'admin-audit__byaction');
  actions.name = 'action';
  actions.setAttribute('aria-label', 'Action');
  const subject = el('input', 'admin-audit__subject');
  subject.name = 'subject';
  subject.placeholder = 'Subject: an account or project id';
  subject.maxLength = MAX_FILTER;
  subject.autocomplete = 'off';
  subject.spellcheck = false;
  subject.value = filter.subject;
  const go = button('Filter', 'btn btn--primary');
  go.type = 'submit';
  const clear = button('Clear', 'btn admin-audit__clear');
  form.append(actions, subject, go, clear);
  const hint = el('p', 'admin__hint muted', 'Newest first. Rows older than twelve months are let go as the log is read.');
  const say = new Say();
  const list = el('div', 'admin-list admin-audit__list');
  const more = button('Load more', 'btn admin-audit__more');
  more.hidden = true;
  host.replaceChildren(form, hint, say.root, list, more);
  const state: State = { filter, next: null, list, more, actions, subject, clear, say };
  fillActions(state, filter.action ? [filter.action] : []);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.filter = { action: actions.value, subject: subject.value.trim() };
    void load(state, false);
  });
  clear.addEventListener('click', () => {
    state.filter = { action: '', subject: '' };
    actions.value = '';
    subject.value = '';
    void load(state, false);
  });
  more.addEventListener('click', () => void load(state, true));
  await load(state, false);
}

/** The action filter's choices: every action the log holds, and the one asked for even if it holds none now. */
function fillActions(state: State, actions: string[]): void {
  const wanted = state.filter.action;
  const all = [...new Set([...actions, ...(wanted ? [wanted] : [])])].sort();
  const any = el('option', '', 'Every action');
  any.value = '';
  state.actions.replaceChildren(
    any,
    ...all.map((a) => {
      const o = el('option', '', a);
      o.value = a;
      return o;
    }),
  );
  state.actions.value = wanted;
}

/** The filter, in the address: a reload, or the address copied, keeps it. */
function remember(filter: AuditFilter): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('action');
  url.searchParams.delete('subject');
  if (filter.action) url.searchParams.set('action', filter.action);
  if (filter.subject) url.searchParams.set('subject', filter.subject);
  history.replaceState(history.state, '', url);
}

async function load(state: State, more: boolean): Promise<void> {
  const { list } = state;
  if (!more) {
    remember(state.filter);
    list.replaceChildren(el('p', 'muted', 'Loading…'));
  }
  state.more.disabled = true;
  state.clear.hidden = !state.filter.action && !state.filter.subject;
  state.say.clear();
  let got: Awaited<ReturnType<typeof auditApi.page>> | null;
  try {
    got = await asOwner(() => auditApi.page(state.filter, more ? state.next : null), !more);
  } catch (err) {
    state.more.disabled = false;
    if (more) state.say.error(refusalText(err));
    else list.replaceChildren(el('p', 'muted', `The log could not be loaded. ${refusalText(err)}`));
    return;
  }
  state.more.disabled = false;
  if (!got) {
    // Not signed in: the first page waits behind the lock; a page more
    // leaves those drawn, and Load more asks again.
    if (more) state.say.error('No more were loaded: the owner tools need you signed in.');
    else {
      list.replaceChildren(ownerSignInPanel(() => void load(state, false)));
      state.more.hidden = true;
    }
    return;
  }
  fillActions(state, got.actions);
  if (!more) list.replaceChildren();
  for (const row of got.rows) list.appendChild(rowOf(row, state));
  if (!more && !got.rows.length) {
    list.appendChild(
      el('p', 'admin__empty', state.filter.action || state.filter.subject ? 'Nothing in the log matches that.' : 'Nothing in the log yet.'),
    );
  }
  state.next = got.next;
  state.more.hidden = got.next === null;
}

function rowOf(r: AuditRow, state: State): HTMLElement {
  const row = el('div', 'admin-row admin-audit__row');
  row.dataset.audit = String(r.id);
  const main = el('div', 'admin-row__main');
  const meta = el('span', 'admin-row__meta');
  meta.append(`${momentOf(r.at)} · by ${r.actor}`);
  if (r.subject) {
    const subject = button(r.subject, 'account-linkbtn admin-audit__subjectbtn');
    subject.title = 'Show only the rows about this';
    subject.addEventListener('click', () => {
      state.filter = { action: '', subject: r.subject ?? '' };
      state.actions.value = '';
      state.subject.value = state.filter.subject;
      void load(state, false);
    });
    meta.append(' · on ', subject);
  }
  const detail = detailText(r.detail);
  main.append(el('span', 'admin-row__title admin-audit__action', r.action), meta);
  if (detail) main.appendChild(el('span', 'admin-row__meta admin-audit__detail', detail));
  row.appendChild(main);
  return row;
}
