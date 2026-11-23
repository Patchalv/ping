import { describe, expect, it } from 'vitest';
import { unpublishedRoutes } from './publish-coverage';

const route = (method: string, path: string) => ({ method, path });

describe('unpublishedRoutes', () => {
  it('lists a mutating route that published nothing', () => {
    expect(
      unpublishedRoutes([route('POST', '/api/things'), route('DELETE', '/api/things/:id')], {
        published: new Set(['DELETE /api/things/:id']),
        exempt: [],
      }),
    ).toEqual(['POST /api/things']);
  });

  it('ignores reads and middleware', () => {
    expect(
      unpublishedRoutes([route('GET', '/api/things'), route('ALL', '/*')], {
        published: new Set(),
        exempt: [],
      }),
    ).toEqual([]);
  });

  it.each(['PUT', 'PATCH', 'POST', 'DELETE'])('checks %s', (method) => {
    expect(
      unpublishedRoutes([route(method, '/api/x')], { published: new Set(), exempt: [] }),
    ).toEqual([`${method} /api/x`]);
  });

  it('passes an exempt route', () => {
    expect(
      unpublishedRoutes([route('POST', '/api/invites/lookup')], {
        published: new Set(),
        exempt: ['POST /api/invites/lookup'],
      }),
    ).toEqual([]);
  });
});
