import { describe, expect, it } from 'vitest';
import { channelParams, createChannelBody } from './channel';

describe('createChannelBody', () => {
  it('accepts a name, description and visibility, trimming the text', () => {
    expect(
      createChannelBody.parse({
        name: '  Front desk ',
        description: ' Reception and visitors ',
        visibility: 'private',
      }),
    ).toEqual({ name: 'Front desk', description: 'Reception and visitors', visibility: 'private' });
  });

  it('defaults the description to empty', () => {
    expect(createChannelBody.parse({ name: 'Ops', visibility: 'public' })).toEqual({
      name: 'Ops',
      description: '',
      visibility: 'public',
    });
  });

  // Every rule a Staff member can trip says what to do, in plain English.
  it.each([
    ['an empty name', { name: '', visibility: 'public' }, 'name', 'Give the Channel a name.'],
    [
      'a name of only spaces',
      { name: '   ', visibility: 'public' },
      'name',
      'Give the Channel a name.',
    ],
    ['no name', { visibility: 'public' }, 'name', 'Give the Channel a name.'],
    [
      'a name over 80 characters',
      { name: 'x'.repeat(81), visibility: 'public' },
      'name',
      'Keep the name to 80 characters or fewer.',
    ],
    [
      'a description over 500 characters',
      { name: 'Ops', description: 'x'.repeat(501), visibility: 'public' },
      'description',
      'Keep the description to 500 characters or fewer.',
    ],
    [
      'an unknown visibility',
      { name: 'Ops', visibility: 'secret' },
      'visibility',
      'Choose Public or Private.',
    ],
    ['no visibility', { name: 'Ops' }, 'visibility', 'Choose Public or Private.'],
  ])('refuses %s, saying why', (_name, body, path, message) => {
    const result = createChannelBody.safeParse(body);
    expect(
      result.error?.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    ).toEqual([{ path, message }]);
  });
});

describe('channelParams', () => {
  it('accepts a UUID', () => {
    const channelId = '00000000-0000-4000-8000-000000000101';
    expect(channelParams.parse({ channelId })).toEqual({ channelId });
  });

  it('refuses anything else, saying why', () => {
    expect(channelParams.safeParse({ channelId: 'front-desk' }).error?.issues[0]?.message).toBe(
      'That isn’t a Channel link.',
    );
  });
});
