import { describe, expect, it } from 'vitest';
import { contentDisposition } from './storage';

describe('contentDisposition', () => {
  it('downloads files and shows images inline', () => {
    expect(contentDisposition({ filename: 'rota.pdf', inline: false })).toBe(
      `attachment; filename="rota.pdf"; filename*=UTF-8''rota.pdf`,
    );
    expect(contentDisposition({ filename: 'desk.jpg', inline: true })).toBe(
      `inline; filename="desk.jpg"; filename*=UTF-8''desk.jpg`,
    );
  });

  it('keeps a non-ASCII name in UTF-8, with a plain fallback', () => {
    expect(contentDisposition({ filename: 'Horari d’estiu (v2).xlsx', inline: false })).toBe(
      `attachment; filename="Horari d_estiu (v2).xlsx"; filename*=UTF-8''Horari%20d%E2%80%99estiu%20%28v2%29.xlsx`,
    );
  });

  it('can’t be broken out of by quotes, backslashes or line breaks in the name', () => {
    expect(contentDisposition({ filename: 'a"b\\c\r\nX-Evil: 1.txt', inline: false })).toBe(
      `attachment; filename="a_b_c__X-Evil: 1.txt"; filename*=UTF-8''a%22b%5Cc%0D%0AX-Evil%3A%201.txt`,
    );
  });
});
