import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  errorResponse,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from './errors';

describe('errorResponse', () => {
  it.each([
    [new UnauthenticatedError(), 401, 'unauthenticated'],
    [new ForbiddenError('Only Channel admins can do that.'), 403, 'forbidden'],
    [new NotFoundError(), 404, 'not_found'],
    [new ConflictError('That name is taken.'), 409, 'conflict'],
    [new ValidationError('Give the Channel a name.'), 400, 'validation'],
  ])('maps %o to its status and a body the UI can show', (error, status, code) => {
    expect(errorResponse(error)).toEqual({
      status,
      body: { error: { code, message: error.message } },
    });
  });

  it('says nothing about what was not found', () => {
    expect(errorResponse(new NotFoundError())?.body.error.message).toBe('Not found.');
  });

  it('returns undefined for an unknown error, which the caller reports as a bare 500', () => {
    expect(errorResponse(new Error('connection refused'))).toBeUndefined();
  });
});
