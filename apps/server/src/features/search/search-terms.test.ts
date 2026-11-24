import { describe, expect, it } from 'vitest';
import { toPrefixTsquery } from './search-terms';

describe('toPrefixTsquery', () => {
  it('requires every word, and matches the last one as a prefix', () => {
    expect(toPrefixTsquery('front desk rota')).toBe('front & desk & rota:*');
  });

  it('matches a single word as a prefix while it is typed', () => {
    expect(toPrefixTsquery('book')).toBe('book:*');
  });

  it('lowercases and ignores extra spacing', () => {
    expect(toPrefixTsquery('  Front   DESK ')).toBe('front & desk:*');
  });

  it('drops tsquery operators and punctuation, so typed text never changes the query', () => {
    expect(toPrefixTsquery("rota & !(friday | 'late'):* <-> x")).toBe('rota & friday & late & x:*');
  });

  it('splits words on punctuation, like the text it is matched against', () => {
    expect(toPrefixTsquery('check-in, e.mail')).toBe('check & in & e & mail:*');
  });

  it('keeps accented letters and digits', () => {
    expect(toPrefixTsquery('Café 2026')).toBe('café & 2026:*');
  });

  it('is null when nothing searchable is left', () => {
    expect(toPrefixTsquery('')).toBeNull();
    expect(toPrefixTsquery('   ')).toBeNull();
    expect(toPrefixTsquery('&|!():*')).toBeNull();
  });
});
