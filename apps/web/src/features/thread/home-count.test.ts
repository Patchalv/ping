import { describe, expect, it } from 'vitest';
import { homeCountState } from './home-count';

const loaded = (data: number) => ({ error: null, data });

describe('what a Home count shows', () => {
  it('shows the count', () => {
    expect(homeCountState(loaded(5))).toEqual({ status: 'ready', count: 5 });
  });

  it('shows a count above the 50 a list page holds', () => {
    expect(homeCountState(loaded(51))).toEqual({ status: 'ready', count: 51 });
  });

  it('is empty at zero', () => {
    expect(homeCountState(loaded(0))).toEqual({ status: 'empty' });
  });

  it('is loading until the count arrives', () => {
    expect(homeCountState({ error: null, data: undefined })).toEqual({ status: 'loading' });
  });

  it('shows the error when the request fails', () => {
    expect(
      homeCountState({ error: new Error('Can’t reach Ping. Try again.'), data: undefined }),
    ).toEqual({ status: 'error', message: 'Can’t reach Ping. Try again.' });
  });

  it('keeps showing the count when a later refetch fails', () => {
    expect(homeCountState({ error: new Error('Can’t reach Ping. Try again.'), data: 2 })).toEqual({
      status: 'ready',
      count: 2,
    });
  });
});
