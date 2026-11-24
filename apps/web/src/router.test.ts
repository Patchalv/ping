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

/**
 * The route `path` matches and its validated search params. Matched without loading: a
 * load whose search the schema rewrites (a default filled in) settles asynchronously.
 */
function searchOf(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const leaf = router.matchRoutes(router.state.location).at(-1);
  return { routeId: leaf?.routeId, search: leaf?.search };
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

  it('reads an open Thread’s path with the Thread Response to scroll to', () => {
    const threadId = '00000000-0000-4000-8000-000000000201';
    const responseId = '00000000-0000-4000-8000-000000000301';
    expect(searchOf(`/channels/${id}/threads/${threadId}?response=${responseId}`)).toEqual({
      routeId: '/channels/$channelId/threads/$threadId',
      search: { response: responseId },
    });
    // A garbled one is ignored: the Thread still opens.
    expect(searchOf(`/channels/${id}/threads/${threadId}?response=x`).search).toEqual({
      response: undefined,
    });
  });

  it('reads the search path with its text, tab and chips', () => {
    expect(searchOf(`/search?q=rota&tab=threads&in=${id}&status=open&near=${id}`)).toEqual({
      routeId: '/search',
      search: { q: 'rota', tab: 'threads', in: id, status: 'open', near: id },
    });
  });

  it('reads a garbled search path with the defaults', () => {
    expect(searchOf('/search?tab=people&in=x&status=z')).toMatchObject({
      routeId: '/search',
      search: { q: '', tab: 'all', status: 'all', in: undefined },
    });
  });

  it.each(['/channels', '/channels/front-desk', `/channels/${id}/threads`, '/nowhere'])(
    'reads %s as not found',
    async (path) => {
      expect((await resolve(path)).notFound).toBe(true);
    },
  );
});
