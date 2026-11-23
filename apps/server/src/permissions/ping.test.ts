import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow } from './decision';
import { canListOwnPings } from './ping';

describe('canListOwnPings', () => {
  it.each([
    ['a Member', { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' }],
    ['a company Admin', { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' }],
  ] as [string, Actor][])('allows %s', (_name, actor) => {
    expect(canListOwnPings(actor)).toEqual(allow());
  });
});
