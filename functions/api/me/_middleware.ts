import { accountsGate } from '../../_shared/auth/gate';

// /api/me and /api/me/* - the signed-in account (docs/accounts.md §3-4):
// not there while accounts are off (404 accounts_off), and never cached.
export const onRequest = accountsGate;
