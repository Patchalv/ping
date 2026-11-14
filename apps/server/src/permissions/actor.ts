/**
 * The signed-in, active Staff member a request acts for. Deactivated and Invited Staff
 * members can't sign in, so they never become an Actor (the session middleware answers
 * 401 instead).
 */
export type Actor = { staffId: string; role: 'admin' | 'member' };
