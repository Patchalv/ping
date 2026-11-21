/**
 * The token from an invite or reset link's fragment (#token=…), which never reaches a
 * server log.
 */
export function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}
