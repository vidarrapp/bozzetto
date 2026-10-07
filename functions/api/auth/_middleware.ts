import { accountsGate } from '../../_shared/auth/gate';

// /api/auth/* - signing in and out (docs/accounts.md §3): not there while
// accounts are off (404 accounts_off), and never cached.
export const onRequest = accountsGate;
