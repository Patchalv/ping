import { describe, expect, it } from 'vitest';
import { AVATAR_COLOURS, avatarColour, initials } from './avatar';

describe('initials', () => {
  it.each([
    ['Rosa Ferrer', 'RF'],
    ['rosa ferrer puig', 'RF'],
    ['  Marta   Ruiz ', 'MR'],
    ['Jordi', 'J'],
    ['Ángel Núñez', 'ÁN'],
    ['', ''],
  ])('%j → %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('avatarColour', () => {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    '9b2d3c1e-8f4a-4e6b-9c7d-1a2b3c4d5e6f',
    '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  ];

  it('keeps a Staff member’s colour across calls, so a rename never changes it', () => {
    for (const id of ids) expect(avatarColour(id)).toBe(avatarColour(id));
  });

  it('picks from the palette', () => {
    for (const id of ids) expect(AVATAR_COLOURS).toContain(avatarColour(id));
  });

  it('spreads different Staff members across the palette', () => {
    expect(new Set(ids.map(avatarColour)).size).toBeGreaterThan(2);
  });
});
