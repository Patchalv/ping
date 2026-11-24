import { describe, expect, it } from 'vitest';
import { systemThreadTitle } from './system-thread';

const marta = { staffId: '00000000-0000-4000-8000-0000000000a1', name: 'Marta Ruiz' };

describe('systemThreadTitle', () => {
  it('names who turned the Channel Private, by their current name', () => {
    expect(systemThreadTitle({ kind: 'channel_made_private', staff: marta })).toBe(
      'Marta Ruiz made this Channel Private',
    );
  });

  it('still reads when the Staff member can’t be found', () => {
    expect(systemThreadTitle({ kind: 'channel_made_private', staff: null })).toBe(
      'This Channel was made Private',
    );
  });

  it('names who archived the Channel, by their current name', () => {
    expect(systemThreadTitle({ kind: 'channel_archived', staff: marta })).toBe(
      'Marta Ruiz archived this Channel',
    );
  });

  it('still reads when whoever archived it can’t be found', () => {
    expect(systemThreadTitle({ kind: 'channel_archived', staff: null })).toBe(
      'This Channel was archived',
    );
  });
});
