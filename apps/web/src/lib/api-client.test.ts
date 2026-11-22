import { describe, expect, it } from 'vitest';
import { ApiError, call, callNoContent, OFFLINE_MESSAGE } from './api-client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('call', () => {
  it('returns the body of a successful response', async () => {
    expect(await call(async () => json(200, { id: 'a' }))).toEqual({ id: 'a' });
  });

  it('throws the server’s message and failing fields for a refusal the UI can explain', async () => {
    const error = await call(async () =>
      json(400, {
        error: {
          code: 'validation',
          message: 'Give the Channel a name.',
          issues: [{ path: 'name', message: 'Give the Channel a name.' }],
        },
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: 'Give the Channel a name.',
      issues: [{ path: 'name', message: 'Give the Channel a name.' }],
    });
  });

  it('throws a 404 as its own status, which is how a hidden Private channel answers', async () => {
    const error = await call(async () =>
      json(404, { error: { code: 'not_found', message: 'Not found.' } }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404 });
  });

  it('falls back to a plain message for a bare 500', async () => {
    const error = await call(
      async () => new Response('Internal Server Error', { status: 500 }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, message: 'Something went wrong. Try again.' });
  });

  it('turns a failed network call into an error the UI can show', async () => {
    const error = await call(async () => {
      throw new TypeError('Failed to fetch');
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, message: OFFLINE_MESSAGE });
  });
});

describe('callNoContent', () => {
  it('resolves on a success with no body', async () => {
    await expect(
      callNoContent(async () => new Response(null, { status: 204 })),
    ).resolves.toBeUndefined();
  });

  it('still throws the server’s message for a refusal', async () => {
    const error = await callNoContent(async () =>
      json(403, { error: { code: 'forbidden', message: 'You can’t leave yet.' } }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 403, message: 'You can’t leave yet.' });
  });
});
