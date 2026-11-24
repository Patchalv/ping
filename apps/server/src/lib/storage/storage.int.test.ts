// The storage module against the local MinIO, which stands in for R2.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LOCAL_STORAGE } from '../../config';
import { createStorage, SIGNED_LINK_SECONDS } from './storage';

const storage = createStorage(LOCAL_STORAGE);

describe('storage', () => {
  it('stores a file and serves it through a signed link that expires in under 5 minutes', async () => {
    const key = randomUUID();
    const content = new TextEncoder().encode('name,room\nMarta,2\n');
    await storage.put(key, content, 'text/csv');

    const link = new URL(
      await storage.signedDownloadUrl(key, {
        filename: 'Horari d’estiu.csv',
        contentType: 'text/csv',
        inline: false,
      }),
    );
    expect(Number(link.searchParams.get('X-Amz-Expires'))).toBe(SIGNED_LINK_SECONDS);
    expect(SIGNED_LINK_SECONDS).toBeLessThan(5 * 60);
    // The key is the random UUID; the filename never appears in the path.
    expect(link.pathname).toBe(`/${LOCAL_STORAGE.bucket}/${key}`);

    const response = await fetch(link);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Horari d_estiu.csv"; filename*=UTF-8''Horari%20d%E2%80%99estiu.csv`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content);
  });

  it('refuses the object without a signature, or with a tampered one', async () => {
    const key = randomUUID();
    await storage.put(key, new Uint8Array([1, 2, 3]), 'application/pdf');
    const link = new URL(
      await storage.signedDownloadUrl(key, {
        filename: 'rota.pdf',
        contentType: 'application/pdf',
        inline: false,
      }),
    );

    const unsigned = new URL(link.pathname, link.origin);
    expect((await fetch(unsigned)).status).toBe(403);

    const tampered = new URL(link);
    tampered.searchParams.set('response-content-type', 'text/html');
    expect((await fetch(tampered)).status).toBe(403);
  });
});
