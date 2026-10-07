import type { Env } from '../../../_shared/env';
import { HttpError } from '../../../_shared/http';
import { answer, api } from '../../../_shared/auth/api';
import { listAudit, sweepAudit } from '../../../_shared/auth/audit';
import { cursorOf, ownerGate, pageLimit, readCursor } from '../../../_shared/owner';
import type { RequestData } from '../../../_shared/principal';

/** The most an action or a subject asked for may be, in characters: the longest written is far shorter. */
const MAX_FILTER = 128;

/** ?action= or ?subject=: null when absent, else as given; 400 bad_request naming it when too long. */
function filter(params: URLSearchParams, name: string): string | null {
  const v = params.get(name);
  if (v === null || v === '') return null;
  if (v.length > MAX_FILTER) {
    throw new HttpError(`${name}: at most ${MAX_FILTER} characters`, 400, 'bad_request', { reason: name });
  }
  return v;
}

// GET /admin/api/audit?before=&action=&subject=&limit= - the Audit tab
// (docs/accounts.md §8): the log, newest first, 50 a page (limit 1-100),
// filtered by an action and a subject (each exact) when asked, as {rows,
// next, actions}. Each row is {id, at, actor, action, subject, detail},
// `detail` the object it was written as; `next` is the `before` for the
// page after (null at the end); `actions` every action the log holds, for
// the filter. Nothing past twelve months is listed, and after the answer
// up to 500 such rows are deleted, oldest first, so the log keeps itself
// to a year. A `before` or limit that is not one is 400 bad_request with
// `reason`. Both locks; with accounts off too, since owner tools write to
// the log then as well (as the Access identity).
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    const denied = ownerGate(env, data, { accounts: false });
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const before = readCursor(params, 'before', /^\d{1,15}$/);
    const page = await listAudit(env, {
      before: before ? { at: before.at, id: Number(before.id) } : null,
      action: filter(params, 'action'),
      subject: filter(params, 'subject'),
      limit: pageLimit(params),
      now: data.now,
    });
    waitUntil(sweepAudit(env, data.now).catch((err: unknown) => console.error('audit sweep failed:', err)));
    return answer({
      rows: page.rows,
      next: page.next ? cursorOf(page.next.at, page.next.id) : null,
      actions: page.actions,
    });
  });
