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

  it.each([
    ['an empty name', { name: '', visibility: 'public' }],
    ['a name of only spaces', { name: '   ', visibility: 'public' }],
    ['a name over 80 characters', { name: 'x'.repeat(81), visibility: 'public' }],
    ['a description over 500 characters', { name: 'Ops', description: 'x'.repeat(501), visibility: 'public' }],
    ['an unknown visibility', { name: 'Ops', visibility: 'secret' }],
    ['no visibility', { name: 'Ops' }],
  ])('refuses %s', (_name, body) => {
    expect(createChannelBody.safeParse(body).success).toBe(false);
  });
});

describe('channelParams', () => {
  it('accepts a UUID', () => {
    const channelId = '00000000-0000-4000-8000-000000000101';
    expect(channelParams.parse({ channelId })).toEqual({ channelId });
  });

  it('refuses anything else', () => {
    expect(channelParams.safeParse({ channelId: 'front-desk' }).success).toBe(false);
  });
});
