/**
 * Postgres's unique_violation, anywhere in the error's cause chain: two requests claiming
 * the same email at once.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
