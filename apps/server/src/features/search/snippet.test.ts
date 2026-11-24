import { describe, expect, it } from 'vitest';
import { MATCH_START, MATCH_STOP, toSnippet } from './snippet';

const marked = (text: string) => `${MATCH_START}${text}${MATCH_STOP}`;

describe('toSnippet', () => {
  it('splits a headline into plain and matched parts', () => {
    expect(toSnippet(`We ${marked('booked')} the ${marked('rota')} today`)).toEqual([
      { text: 'We ', match: false },
      { text: 'booked', match: true },
      { text: ' the ', match: false },
      { text: 'rota', match: true },
      { text: ' today', match: false },
    ]);
  });

  it('keeps a headline with no match as one plain part', () => {
    expect(toSnippet('Who covers Friday?')).toEqual([{ text: 'Who covers Friday?', match: false }]);
  });

  it('joins words matched side by side, and collapses spacing', () => {
    expect(toSnippet(`${marked('front')} ${marked('desk')}\n\n  rota`)).toEqual([
      { text: 'front desk', match: true },
      { text: ' rota', match: false },
    ]);
  });

  it('is empty for empty text', () => {
    expect(toSnippet('')).toEqual([]);
    expect(toSnippet('  ')).toEqual([]);
  });

  it('never treats HTML as markup: it stays text', () => {
    expect(toSnippet(`<b>${marked('x')}</b>`)).toEqual([
      { text: '<b>', match: false },
      { text: 'x', match: true },
      { text: '</b>', match: false },
    ]);
  });
});
