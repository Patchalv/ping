import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canListMentionCandidates, canMention, MENTION_REFUSED } from './mention';

const actor: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };

const someone = (overrides: Partial<{ state: 'active' | 'invited' | 'deactivated' }> = {}) => ({
  state: overrides.state ?? ('active' as const),
});

describe('canMention', () => {
  it.each([
    ['a member of a Public channel', 'public', true],
    ['a non-member of a Public channel: Mentioning them does not make them join', 'public', false],
    ['a member of a Private channel', 'private', true],
  ] as const)('allows Mentioning %s', (_name, visibility, isMember) => {
    expect(canMention(actor, { visibility }, { ...someone(), isMember })).toEqual(allow());
  });

  it('refuses a non-member of a Private channel: they cannot read the Thread', () => {
    expect(canMention(actor, { visibility: 'private' }, { ...someone(), isMember: false })).toEqual(
      deny({ kind: 'refused', message: MENTION_REFUSED }),
    );
  });

  it.each(['invited', 'deactivated'] as const)(
    'refuses an %s Staff member, even a Channel member',
    (state) => {
      for (const visibility of ['public', 'private'] as const) {
        expect(
          canMention(actor, { visibility }, { ...someone({ state }), isMember: true }),
        ).toEqual(deny({ kind: 'refused', message: MENTION_REFUSED }));
      }
    },
  );

  it('refuses someone who is not a Staff member at all', () => {
    expect(canMention(actor, { visibility: 'public' }, undefined)).toEqual(
      deny({ kind: 'refused', message: MENTION_REFUSED }),
    );
  });
});

describe('canListMentionCandidates', () => {
  it('follows reading: a Public channel for anyone, a Private one for its members', () => {
    expect(canListMentionCandidates(actor, { visibility: 'public', isMember: false })).toEqual(
      allow(),
    );
    expect(canListMentionCandidates(actor, { visibility: 'private', isMember: true })).toEqual(
      allow(),
    );
  });

  it('hides a Private channel from someone who is not a member', () => {
    expect(canListMentionCandidates(actor, { visibility: 'private', isMember: false })).toEqual(
      deny({ kind: 'hidden' }),
    );
  });
});
