import { describe, expect, it } from 'vitest';
import {
  createSectionBody,
  placeChannelBody,
  reorderSectionsBody,
  sectionParams,
  updateSectionBody,
} from './section';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const firstIssue = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('createSectionBody', () => {
  it('accepts a name, trimmed', () => {
    expect(createSectionBody.parse({ name: '  Teaching ' })).toEqual({ name: 'Teaching' });
  });

  it.each([
    ['an empty name', { name: '' }, 'Give the Section a name.'],
    ['a name of only spaces', { name: '   ' }, 'Give the Section a name.'],
    ['no name', {}, 'Give the Section a name.'],
    [
      'a name over 40 characters',
      { name: 'x'.repeat(41) },
      'Keep the name to 40 characters or fewer.',
    ],
  ])('refuses %s with a plain message', (_case, body, message) => {
    expect(firstIssue(createSectionBody.safeParse(body))).toBe(message);
  });
});

describe('updateSectionBody', () => {
  it('accepts a new name, a collapsed state, or both', () => {
    expect(updateSectionBody.parse({ name: ' Ops ' })).toEqual({ name: 'Ops' });
    expect(updateSectionBody.parse({ collapsed: true })).toEqual({ collapsed: true });
    expect(updateSectionBody.parse({ name: 'Ops', collapsed: false })).toEqual({
      name: 'Ops',
      collapsed: false,
    });
  });

  it('refuses a change that changes nothing', () => {
    expect(firstIssue(updateSectionBody.safeParse({}))).toBe(
      'Rename the Section, or collapse or expand it.',
    );
  });

  it('refuses an empty name', () => {
    expect(firstIssue(updateSectionBody.safeParse({ name: ' ' }))).toBe('Give the Section a name.');
  });
});

describe('reorderSectionsBody', () => {
  it('accepts every Section in its new order', () => {
    expect(reorderSectionsBody.parse({ sectionIds: [id(2), id(1)] })).toEqual({
      sectionIds: [id(2), id(1)],
    });
  });

  it('refuses a Section listed twice', () => {
    expect(firstIssue(reorderSectionsBody.safeParse({ sectionIds: [id(1), id(1)] }))).toBe(
      'List each Section once.',
    );
  });

  it('refuses something that isn’t a Section', () => {
    expect(firstIssue(reorderSectionsBody.safeParse({ sectionIds: ['nope'] }))).toBe(
      'That isn’t a Section.',
    );
  });
});

describe('placeChannelBody', () => {
  it('accepts a Section and a position, or null for the default Channels section', () => {
    expect(placeChannelBody.parse({ sectionId: id(1), position: 2 })).toEqual({
      sectionId: id(1),
      position: 2,
    });
    expect(placeChannelBody.parse({ sectionId: null })).toEqual({ sectionId: null });
  });

  it('refuses a missing Section and a negative position', () => {
    expect(firstIssue(placeChannelBody.safeParse({}))).toBe(
      'Choose a Section, or the Channels section.',
    );
    expect(firstIssue(placeChannelBody.safeParse({ sectionId: id(1), position: -1 }))).toBe(
      'That isn’t a place in the Section.',
    );
  });
});

describe('sectionParams', () => {
  it('refuses a Section ID that isn’t a UUID', () => {
    expect(firstIssue(sectionParams.safeParse({ sectionId: '42' }))).toBe('That isn’t a Section.');
  });
});
