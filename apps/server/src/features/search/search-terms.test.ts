import { describe, expect, it } from 'vitest';
import { toSearchTerms } from './search-terms';

describe('toSearchTerms', () => {
  it('requires every word, and keeps the last one apart to match as a prefix', () => {
    expect(toSearchTerms('front desk rota')).toEqual({ words: 'front & desk', last: 'rota:*' });
  });

  it('matches a single word as a prefix while it is typed', () => {
    expect(toSearchTerms('book')).toEqual({ words: '', last: 'book:*' });
  });

  it('lowercases and ignores extra spacing', () => {
    expect(toSearchTerms('  Front   DESK ')).toEqual({ words: 'front', last: 'desk:*' });
  });

  it('drops tsquery operators and punctuation, so typed text never changes the query', () => {
    expect(toSearchTerms("rota & !(friday | 'late'):* <-> x")).toEqual({
      words: 'rota & friday & late',
      last: 'x:*',
    });
  });

  it('splits words on punctuation, like the text it is matched against', () => {
    expect(toSearchTerms('check-in, e.mail')).toEqual({ words: 'check & in & e', last: 'mail:*' });
  });

  it('keeps accented letters and digits', () => {
    expect(toSearchTerms('Café 2026')).toEqual({ words: 'café', last: '2026:*' });
  });

  it('is null when nothing searchable is left', () => {
    expect(toSearchTerms('')).toBeNull();
    expect(toSearchTerms('   ')).toBeNull();
    expect(toSearchTerms('&|!():*')).toBeNull();
  });
});
