import { describe, expect, it } from 'vitest';
import { apiErrorMessage, toResource } from './api-error';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiErrorMessage', () => {
  it('shows the server’s message for a refusal the UI can explain', async () => {
    const res = json(400, { error: { code: 'validation', message: 'Give the Channel a name.' } });
    expect(await apiErrorMessage(res)).toBe('Give the Channel a name.');
  });

  it('asks the Staff member to sign in again after a 401', async () => {
    const res = json(401, { error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
    expect(await apiErrorMessage(res)).toBe('Sign in to continue.');
  });

  it('falls back to a plain message for a bare 500', async () => {
    const res = new Response('Internal Server Error', { status: 500 });
    expect(await apiErrorMessage(res)).toBe('Something went wrong. Try again.');
  });
});

describe('toResource', () => {
  it('reads a successful response as ready', async () => {
    expect(await toResource(json(200, { id: 'a' }))).toEqual({
      status: 'ready',
      data: { id: 'a' },
    });
  });

  it('reads a 404 as not found, which is how a hidden Private channel answers', async () => {
    expect(
      await toResource(json(404, { error: { code: 'not_found', message: 'Not found.' } })),
    ).toEqual({ status: 'notFound' });
  });

  it('reads any other failure as an error with its message', async () => {
    expect(await toResource(new Response('nope', { status: 500 }))).toEqual({
      status: 'error',
      message: 'Something went wrong. Try again.',
    });
  });
});
