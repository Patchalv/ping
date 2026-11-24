// Integration project globalSetup: migrations run once, as the owner, into a template
// database with the real roles and policies. Workers clone it in worker-setup.ts. The local
// MinIO gets its Attachments bucket, which the deployed buckets already have.
import { LOCAL_STORAGE } from '../config';
import { buildTemplate } from '../db/test-support';
import { ensureLocalBucket } from '../lib/storage/storage';

export default async function setup(): Promise<void> {
  await Promise.all([buildTemplate(), ensureLocalBucket(LOCAL_STORAGE)]);
}
