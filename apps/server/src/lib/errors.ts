// The typed errors. Routes and the permissions module throw them; one Hono onError
// (app.ts) maps them to a status and a body the UI can show. Routes never set error
// statuses by hand. Anything else is a bug: a bare 500, reported to Sentry.

abstract class AppError extends Error {
  abstract readonly status: 400 | 401 | 403 | 404 | 409;
  abstract readonly code: string;
}

/** No signed-in, active Staff member behind the request. */
export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code = 'unauthenticated';
  constructor(message = 'Sign in to continue.') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/** The actor can see the thing but can't do this to it. The message is shown in the UI. */
export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'forbidden';
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Missing, or hidden from the actor (a Private channel they aren't in, Admins included).
 * The two answer the same, so a Private channel's existence never leaks.
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'not_found';
  constructor() {
    super('Not found.');
    this.name = 'NotFoundError';
  }
}

/** The request clashes with the current state. The message is shown in the UI. */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'conflict';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** The input failed its zod schema. */
export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'validation';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type ErrorBody = { error: { code: string; message: string } };

/** The response for a typed error, or undefined for anything else. */
export function errorResponse(
  error: unknown,
): { status: AppError['status']; body: ErrorBody } | undefined {
  if (!(error instanceof AppError)) return undefined;
  return { status: error.status, body: { error: { code: error.code, message: error.message } } };
}
