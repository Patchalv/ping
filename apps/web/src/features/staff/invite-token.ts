/** The path an invite link opens: the set-password page. */
export const ACCEPT_INVITE_PATH = '/accept-invite';

/** The token from the invite link's fragment (#token=…), which never reaches a server log. */
export function inviteTokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}
