// The two Attachment sweepers (data-model.md › Housekeeping), as ping_system against this
// worker's database, with a fake object store. Other tests' rows share the database, so
// each case checks only its own files.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, createStaffMember, insertAttachment, testUrls } from '../db/test-support';
import type { Storage } from '../lib/storage/storage';
import { createSystemActions, type SystemActions } from './index';
import { sweepFiles, sweepPendingUploads } from './sweepers';

let systemActions: SystemActions;
beforeAll(() => {
  systemActions = createSystemActions(testUrls().system);
});
afterAll(async () => {
  await systemActions.close();
});

/** A store that records deletes, and fails for the keys in `failing`. */
function fakeStorage(failing: ReadonlySet<string> = new Set()) {
  const deleted: string[] = [];
  const storage: Pick<Storage, 'delete'> = {
    async delete(objectKey) {
      if (failing.has(objectKey)) throw new Error('R2 timed out');
      deleted.push(objectKey);
    },
  };
  return { storage, deleted };
}

const queue = (objectKey: string) =>
  asOwner((query) =>
    query('insert into pending_file_deletion (object_key) values ($1)', [objectKey]),
  );

const queueRow = (objectKey: string) =>
  asOwner(async (query) => {
    const result = await query<{ attempts: number; last_error: string | null }>(
      'select attempts, last_error from pending_file_deletion where object_key = $1',
      [objectKey],
    );
    return result.rows[0];
  });

describe('sweepFiles', () => {
  it('deletes each queued file, then its row', async () => {
    const keys = [randomUUID(), randomUUID()];
    for (const key of keys) await queue(key);
    const { storage, deleted } = fakeStorage();
    await sweepFiles({ systemActions, storage }, { limit: 10_000 });
    expect(deleted).toEqual(expect.arrayContaining(keys));
    for (const key of keys) expect(await queueRow(key)).toBeUndefined();
  });

  it('keeps a file that fails, counting the attempt and its error, until a sweep deletes it', async () => {
    const key = randomUUID();
    await queue(key);
    const failing = fakeStorage(new Set([key]));
    await sweepFiles({ systemActions, storage: failing.storage }, { limit: 10_000 });
    expect(await queueRow(key)).toEqual({ attempts: 1, last_error: 'R2 timed out' });
    await sweepFiles({ systemActions, storage: failing.storage }, { limit: 10_000 });
    expect(await queueRow(key)).toEqual({ attempts: 2, last_error: 'R2 timed out' });

    const working = fakeStorage();
    await sweepFiles({ systemActions, storage: working.storage }, { limit: 10_000 });
    expect(working.deleted).toContain(key);
    expect(await queueRow(key)).toBeUndefined();
  });
});

describe('sweepPendingUploads', () => {
  it('deletes pending Attachments older than 24 hours and queues their files', async () => {
    const uploader = await createStaffMember();
    const old = await insertAttachment({ uploaderId: uploader.id });
    const recent = await insertAttachment({ uploaderId: uploader.id });
    await asOwner((query) =>
      query(`update attachment set created_at = now() - interval '25 hours' where id = $1`, [
        old.id,
      ]),
    );

    await sweepPendingUploads({ systemActions });

    const left = await asOwner(async (query) =>
      (
        await query<{ id: string }>('select id from attachment where id = any($1)', [
          [old.id, recent.id],
        ])
      ).rows.map((r) => r.id),
    );
    expect(left).toEqual([recent.id]);
    expect(await queueRow(old.objectKey)).toEqual({ attempts: 0, last_error: null });
    expect(await queueRow(recent.objectKey)).toBeUndefined();
  });
});
