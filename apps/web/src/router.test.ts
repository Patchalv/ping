import { createMemoryHistory, isNotFound } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from './router';

const id = '00000000-0000-4000-8000-000000000101';

/** Loads `path` and says which route matched, or that none did. */
async function resolve(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const matches = router.state.matches;
  const leaf = matches.at(-1);
  return {
    // A parse failure throws notFound(); an unknown path flags the root match.
    notFound: matches.some((m) => isNotFound(m.error) || m._notFound === true),
    routeId: leaf?.routeId,
    params: leaf?.params,
  };
}

describe('routes', () => {
  it('reads the root as home', async () => {
    expect(await resolve('/')).toMatchObject({ notFound: false, routeId: '/' });
  });

  it('reads a Channel path', async () => {
    expect(await resolve(`/channels/${id}`)).toMatchObject({
      notFound: false,
      routeId: '/channels/$channelId',
      params: { channelId: id },
    });
  });

  it('reads a Channel’s Members tab path', async () => {
    expect(await resolve(`/channels/${id}/members`)).toMatchObject({
      notFound: false,
      routeId: '/channels/$channelId/members',
      params: { channelId: id },
    });
  });

  it('reads an open Thread’s path, inside its Channel', async () => {
    const threadId = '00000000-0000-4000-8000-000000000201';
    expect(await resolve(`/channels/${id}/threads/${threadId}`)).toMatchObject({
      notFound: false,
      routeId: '/channels/$channelId/threads/$threadId',
      params: { channelId: id, threadId },
    });
  });

  it('reads a Thread path with a bad Thread ID as not found', async () => {
    expect(await resolve(`/channels/${id}/threads/heater`)).toMatchObject({ notFound: true });
  });

  it('reads a Members tab path with a bad Channel ID as not found', async () => {
    expect(await resolve('/channels/front-desk/members')).toMatchObject({ notFound: true });
  });

  it('tolerates a trailing slash', async () => {
    expect(await resolve(`/channels/${id}/`)).toMatchObject({
      notFound: false,
      params: { channelId: id },
    });
  });

  it.each(['/channels', '/channels/front-desk', `/channels/${id}/threads`, '/nowhere'])(
    'reads %s as not found',
    async (path) => {
      expect((await resolve(path)).notFound).toBe(true);
    },
  );
});
