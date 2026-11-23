import { describe, expect, it } from 'vitest';
import { matchMentionCandidates } from './mention-query';

const person = (name: string, n: number) => ({
  staffId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name,
});

const jordi = person('Jordi Puig', 1);
const laura = person('Laura Gómez', 2);
const pablo = person('Pablo Serra', 3);
const ramon = person('Ramón Jordà', 4);

describe('matchMentionCandidates', () => {
  it('lists everyone, up to eight, for an empty query', () => {
    const many = Array.from({ length: 10 }, (_, i) => person(`Person ${i}`, i + 10));
    expect(matchMentionCandidates([jordi, laura], '')).toEqual([jordi, laura]);
    expect(matchMentionCandidates(many, '')).toHaveLength(8);
  });

  it('puts names that start with the query before names that only contain it', () => {
    expect(matchMentionCandidates([ramon, jordi, pablo], 'jord')).toEqual([jordi, ramon]);
  });

  it('ignores case and accents, both ways', () => {
    expect(matchMentionCandidates([laura, ramon], 'GOMEZ')).toEqual([laura]);
    expect(matchMentionCandidates([laura, ramon], 'ramón')).toEqual([ramon]);
    expect(matchMentionCandidates([laura, ramon], 'ramon')).toEqual([ramon]);
  });

  it('matches across the space in a full name', () => {
    expect(matchMentionCandidates([jordi, pablo], 'pablo s')).toEqual([pablo]);
  });

  it('finds no one for a name that isn’t there', () => {
    expect(matchMentionCandidates([jordi, laura], 'xavi')).toEqual([]);
  });
});
