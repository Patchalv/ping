// Object storage for Attachments (platform.md › Object storage): Cloudflare R2 in staging
// and prod, MinIO locally and in CI. A thin wrapper around an S3 signing client, with
// path-style URLs so the same code talks to both. Object keys are random UUIDs; the
// original filename lives only in Postgres and reaches the browser only through the
// signed link's Content-Disposition.
import { AwsClient } from 'aws4fetch';

export type StorageSettings = {
  /** The S3 endpoint, e.g. https://<account_id>.eu.r2.cloudflarestorage.com. */
  endpoint: string;
  /** `auto` for R2. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** How long a signed download link lives: under 5 minutes (product.md › Attachments). */
export const SIGNED_LINK_SECONDS = 4 * 60;

/** What a download is served as. Images open in the browser; other files download. */
export type Delivery = { filename: string; contentType: string; inline: boolean };

export type Storage = {
  /** The storage origin, which the CSP allows images from. */
  origin: string;
  put(objectKey: string, content: Uint8Array, contentType: string): Promise<void>;
  /** A GET link that expires in SIGNED_LINK_SECONDS and serves the file as `delivery`. */
  signedDownloadUrl(objectKey: string, delivery: Delivery): Promise<string>;
};

/**
 * The Content-Disposition a download is served with: `attachment`, or `inline` for images,
 * with the original filename in an ASCII fallback and in UTF-8 (RFC 6266).
 */
export function contentDisposition({ filename, inline }: Omit<Delivery, 'contentType'>): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createStorage(settings: StorageSettings): Storage {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
    retries: 2,
  });
  const base = settings.endpoint.replace(/\/+$/, '');
  const objectUrl = (objectKey: string) =>
    new URL(`${base}/${encodeURIComponent(settings.bucket)}/${encodeURIComponent(objectKey)}`);

  return {
    origin: new URL(base).origin,

    async put(objectKey, content, contentType) {
      const response = await client.fetch(objectUrl(objectKey), {
        method: 'PUT',
        body: content,
        headers: { 'Content-Type': contentType, 'Content-Length': String(content.length) },
      });
      if (!response.ok) {
        throw new Error(
          `Storing an Attachment failed: ${response.status} ${await response.text()}`,
        );
      }
    },

    async signedDownloadUrl(objectKey, delivery) {
      const url = objectUrl(objectKey);
      url.searchParams.set('X-Amz-Expires', String(SIGNED_LINK_SECONDS));
      // The stored type is the one the server detected; pinning it here keeps the browser
      // from being told anything else.
      url.searchParams.set('response-content-type', delivery.contentType);
      url.searchParams.set('response-content-disposition', contentDisposition(delivery));
      const signed = await client.sign(url, { method: 'GET', aws: { signQuery: true } });
      return signed.url;
    },
  };
}

/**
 * Creates the bucket if it's missing. Only for MinIO in local development, tests and CI:
 * the deployed tokens are scoped to a bucket that already exists.
 */
export async function ensureLocalBucket(settings: StorageSettings): Promise<void> {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
  });
  const url = `${settings.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(settings.bucket)}`;
  const response = await client.fetch(url, { method: 'PUT' });
  if (response.ok) return;
  const body = await response.text();
  if (body.includes('BucketAlreadyOwnedByYou') || body.includes('BucketAlreadyExists')) return;
  throw new Error(`Creating the local bucket failed: ${response.status} ${body}`);
}
