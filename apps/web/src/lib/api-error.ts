// Reading the typed hc client's responses. The server's typed errors carry a message
// written for the UI (onError in apps/server/src/app.ts); anything else gets a plain one.

type ApiResponse<T> = { ok: boolean; status: number; json(): Promise<T> };

/** Something loaded from the API, as a screen renders it. */
export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'notFound' }
  | { status: 'error'; message: string };

/** The message to show for a failed API response. */
export async function apiErrorMessage(res: { json(): Promise<unknown> }): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON: a bare 500, or a proxy's error page.
  }
  return 'Something went wrong. Try again.';
}

/**
 * A response as a Resource. 404 is its own state: a Private channel the Staff member
 * can't see answers exactly like one that doesn't exist.
 */
export async function toResource<T>(res: ApiResponse<T>): Promise<Resource<T>> {
  if (res.ok) return { status: 'ready', data: await res.json() };
  if (res.status === 404) return { status: 'notFound' };
  return { status: 'error', message: await apiErrorMessage(res) };
}
