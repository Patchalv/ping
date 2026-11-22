import { describe, expect, it } from 'vitest';
import { toEditedMark } from './edited';

const author = '00000000-0000-4000-8000-0000000000a1';
const admin = '00000000-0000-4000-8000-0000000000a2';
const at = new Date('2026-11-22T10:00:00.000Z');

describe('toEditedMark', () => {
  it('is null when never edited', () => {
    expect(
      toEditedMark({ authorId: author, editedAt: null, editedBy: null, editorName: null }),
    ).toBeNull();
  });

  it('reads plain "edited" when the author edited it', () => {
    expect(
      toEditedMark({ authorId: author, editedAt: at, editedBy: author, editorName: 'Jordi Puig' }),
    ).toEqual({ at: '2026-11-22T10:00:00.000Z', by: null });
  });

  it('names the editor when someone else edited it', () => {
    expect(
      toEditedMark({ authorId: author, editedAt: at, editedBy: admin, editorName: 'Marta Ruiz' }),
    ).toEqual({ at: '2026-11-22T10:00:00.000Z', by: { staffId: admin, name: 'Marta Ruiz' } });
  });
});
