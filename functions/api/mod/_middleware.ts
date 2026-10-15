import { accountsGate } from '../../_shared/auth/gate';

// /api/mod/* - the reviewers' routes (docs/accounts.md §13), for the owner
// and moderators on their app session: not there while accounts are off
// (404 accounts_off), and never cached.
export const onRequest = accountsGate;
