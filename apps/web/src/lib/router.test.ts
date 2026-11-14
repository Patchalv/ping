import { describe, expect, it } from 'vitest';
import { channelPath, parseRoute } from './router';

const id = '00000000-0000-4000-8000-000000000101';

describe('parseRoute', () => {
  it('reads the root as home', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
  });

  it('reads a Channel path', () => {
    expect(parseRoute(`/channels/${id}`)).toEqual({ name: 'channel', channelId: id });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute(`/channels/${id}/`)).toEqual({ name: 'channel', channelId: id });
  });

  it.each(['/channels', '/channels/front-desk', `/channels/${id}/threads`, '/nowhere'])(
    'reads %s as not found',
    (path) => {
      expect(parseRoute(path)).toEqual({ name: 'notFound' });
    },
  );
});

describe('channelPath', () => {
  it('round-trips through parseRoute', () => {
    expect(parseRoute(channelPath(id))).toEqual({ name: 'channel', channelId: id });
  });
});
