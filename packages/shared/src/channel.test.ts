import { describe, expect, it } from 'vitest';
import {
  addChannelMemberBody,
  channelMemberParams,
  channelParams,
  createChannelBody,
  setChannelAdminBody,
} from './channel';

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

describe('the member schemas', () => {
  const staffId = '00000000-0000-4000-8000-0000000000b1';
  const channelId = '00000000-0000-4000-8000-0000000000c1';

  it('accept a Channel and Staff member link', () => {
    expect(channelMemberParams.parse({ channelId, staffId })).toEqual({ channelId, staffId });
  });

  it('accept the Staff member to add, and the Channel admin role to set', () => {
    expect(addChannelMemberBody.parse({ staffId })).toEqual({ staffId });
    expect(setChannelAdminBody.parse({ isChannelAdmin: true })).toEqual({ isChannelAdmin: true });
  });

  it.each([
    ['a missing Staff member to add', addChannelMemberBody, {}, 'Choose a Staff member to add.'],
    [
      'a Staff member to add that is no ID',
      addChannelMemberBody,
      { staffId: 'jordi' },
      'Choose a Staff member to add.',
    ],
    [
      'a missing Channel admin role',
      setChannelAdminBody,
      {},
      'Say whether they should be Channel admin.',
    ],
    [
      'a Staff member link that is no ID',
      channelMemberParams,
      { channelId, staffId: 'jordi' },
      'That isn’t a Staff member.',
    ],
  ])('say what to do about %s', (_name, schema, input, message) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});
