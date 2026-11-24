import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canSearch, canSearchInChannel } from './search';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

describe('canSearch', () => {
  it.each([member, admin])('allows anyone: row-level security decides what they find', (actor) => {
    expect(canSearch(actor)).toEqual(allow());
  });
});

describe('canSearchInChannel', () => {
  it.each([member, admin])('allows In: a Public channel, joined or not', (actor) => {
    expect(canSearchInChannel(actor, { visibility: 'public', isMember: false })).toEqual(allow());
  });

  it.each([member, admin])('allows In: a Private channel they are in', (actor) => {
    expect(canSearchInChannel(actor, { visibility: 'private', isMember: true })).toEqual(allow());
  });

  it.each([member, admin])(
    'hides a Private channel they are not in, company Admins included',
    (actor) => {
      expect(canSearchInChannel(actor, { visibility: 'private', isMember: false })).toEqual(
        deny({ kind: 'hidden' }),
      );
    },
  );
});
