// The typed errors. Routes and the permissions module throw them; one Hono onError
// (app.ts) maps them, and Hono's own HTTPExceptions, to a status and one envelope the UI
// can show: { error: { code, message, issues? } }. Routes never set error statuses by
// hand. Anything else is a bug: a bare 500, reported to Sentry.
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

abstract class AppError extends Error {
  abstract readonly status: 400 | 401 | 403 | 404 | 409 | 429;
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
  /** A custom message only where nothing could leak, such as a dead invite link. */
  constructor(message = 'Not found.') {
    super(message);
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

/** The client sent too many requests to a rate-limited route. */
export class TooManyRequestsError extends AppError {
  readonly status = 429;
  readonly code = 'rate_limited';
  constructor() {
    super('Too many attempts. Wait a minute, then try again.');
    this.name = 'TooManyRequestsError';
  }
}

/** One failing field, so a form can mark it. `path` is dotted, e.g. `name`. */
export type FieldIssue = { path: string; message: string };

/** The input failed its zod schema. `message` is the first issue's. */
export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'validation';
  constructor(
    message: string,
    readonly issues: FieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type ErrorBody = { error: { code: string; message: string; issues?: FieldIssue[] } };

const CODE_BY_STATUS: Record<number, string> = {
  400: 'validation',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};

/**
 * The response for a typed error or one of Hono's own (a malformed JSON body, the Origin
 * check), or undefined for anything else.
 */
export function errorResponse(
  error: unknown,
): { status: ContentfulStatusCode; body: ErrorBody } | undefined {
  if (error instanceof ValidationError && error.issues.length > 0) {
    const { code, message, issues } = error;
    return { status: error.status, body: { error: { code, message, issues } } };
  }
  if (error instanceof AppError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof HTTPException && error.status < 500) {
    const status = error.status as ContentfulStatusCode;
    const code = CODE_BY_STATUS[status] ?? 'request';
    return { status, body: { error: { code, message: error.message || 'Check the request.' } } };
  }
  return undefined;
}
