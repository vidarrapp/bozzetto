import type { Env } from '../env';
import type { UserRow } from '../types';

/**
 * Things an account's holder is told by mail (docs/accounts.md §6): a
 * passkey added or removed, so a change they did not make does not go
 * unnoticed. Mail comes with Batch 4; until then this is the seam, and it
 * only logs - the account's id and the event, never the address.
 */
export type Notice = 'passkey.added' | 'passkey.removed';

export async function notify(
  _env: Env,
  user: Pick<UserRow, 'id'>,
  notice: Notice,
  detail: Record<string, string | number> = {},
): Promise<void> {
  console.log(`notify ${notice} for ${user.id} ${JSON.stringify(detail)} (mail comes with Batch 4)`);
}
