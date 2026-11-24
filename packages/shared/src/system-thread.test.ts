import { describe, expect, it } from 'vitest';
import { systemThreadTitle } from './system-thread';

describe('systemThreadTitle', () => {
  it('names who turned the Channel Private, by their current name', () => {
    expect(
      systemThreadTitle({
        kind: 'channel_made_private',
        staff: { staffId: '00000000-0000-4000-8000-0000000000a1', name: 'Marta Ruiz' },
      }),
    ).toBe('Marta Ruiz made this Channel Private');
  });

  it('still reads when the Staff member can’t be found', () => {
    expect(systemThreadTitle({ kind: 'channel_made_private', staff: null })).toBe(
      'This Channel was made Private',
    );
  });
});
