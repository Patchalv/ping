// Calling the API. Each feature's api.ts wraps its typed hc calls in call(), inside its
// query and mutation hooks; components never call hc or read a response themselves.
// A failure becomes an ApiError carrying the server's envelope
// ({ error: { code, message, issues? } }), so screens show the server's own message.

export type FieldIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    /** The HTTP status, or 0 when the call never reached Ping. */
    readonly status: number,
    message: string,
    readonly issues: FieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const OFFLINE_MESSAGE = 'Can’t reach Ping. Try again.';
const FALLBACK_MESSAGE = 'Something went wrong. Try again.';

type ApiResponse<T> = { ok: boolean; status: number; json(): Promise<T> };

/** Sends one request and returns its body, or throws an ApiError. */
export async function call<T>(send: () => Promise<ApiResponse<T>>): Promise<T> {
  let res: ApiResponse<T>;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  }
  if (res.ok) return res.json();
  throw await toApiError(res);
}

async function toApiError(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  try {
    const { error } = (await res.json()) as {
      error?: { message?: unknown; issues?: FieldIssue[] };
    };
    if (typeof error?.message === 'string') {
      return new ApiError(res.status, error.message, error.issues ?? []);
    }
  } catch {
    // Not JSON: a bare 500, or a proxy's error page.
  }
  return new ApiError(res.status, FALLBACK_MESSAGE);
}
