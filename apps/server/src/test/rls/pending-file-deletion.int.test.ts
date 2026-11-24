// RLS suite: pending_file_deletion is insert only for ping_app, and only for the key of an
// Attachment it can see. Only ping_system reads, updates and deletes the queue.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  asPingSystem,
  createStaffMember,
  insertAttachment,
  insertChannel,
  insertThread,
} from '../../db/test-support';

const queue = `insert into pending_file_deletion (object_key) values ($1)`;

/** An Attachment on a Thread in a Channel of `visibility`, uploaded by its only member. */
async function attachedFile(visibility: 'public' | 'private') {
  const member = await createStaffMember();
  const channel = await insertChannel({
    visibility,
    members: [{ staffId: member.id, channelAdmin: true }],
  });
  const thread = await insertThread({ channelId: channel.id, authorId: member.id });
  const file = await insertAttachment({
    uploaderId: member.id,
    channelId: channel.id,
    threadId: thread.id,
  });
  return { member, file };
}

describe('pending_file_deletion as ping_app', () => {
  it('lets a Staff member queue the file of an Attachment they can see', async () => {
    const { member, file } = await attachedFile('private');
    await asPingApp(member.id, async (query) => {
      expect((await query(queue, [file.objectKey])).rowCount).toBe(1);
    });
  });

  it('lets an uploader queue their own pending Attachment’s file', async () => {
    const member = await createStaffMember();
    const pending = await insertAttachment({ uploaderId: member.id });
    await asPingApp(member.id, async (query) => {
      expect((await query(queue, [pending.objectKey])).rowCount).toBe(1);
    });
  });

  it('refuses a key that belongs to no Attachment it can see', async () => {
    const { file } = await attachedFile('private');
    const outsider = await createStaffMember({ role: 'admin' });
    for (const key of [file.objectKey, randomUUID()]) {
      await asPingApp(outsider.id, async (query) => {
        await expect(query(queue, [key])).rejects.toThrow(/row-level security/);
      });
    }
  });

  it('refuses setting the attempts or the error', async () => {
    const { member, file } = await attachedFile('public');
    await asPingApp(member.id, async (query) => {
      await expect(
        query(`insert into pending_file_deletion (object_key, attempts) values ($1, 5)`, [
          file.objectKey,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('refuses a Deactivated Staff member', async () => {
    const { member, file } = await attachedFile('public');
    const admin = await createStaffMember({ role: 'admin' });
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        member.id,
        admin.id,
      ]),
    );
    await asPingApp(member.id, async (query) => {
      await expect(query(queue, [file.objectKey])).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const { file } = await attachedFile('public');
    await asPingApp(null, async (query) => {
      await expect(query(queue, [file.objectKey])).rejects.toThrow(/row-level security/);
    });
  });

  it('can’t read, update or delete the queue', async () => {
    const { member, file } = await attachedFile('public');
    await asOwner((query) => query(queue, [file.objectKey]));
    for (const statement of [
      'select object_key from pending_file_deletion',
      'update pending_file_deletion set attempts = 0',
      'delete from pending_file_deletion',
    ]) {
      await asPingApp(member.id, async (query) => {
        await expect(query(statement)).rejects.toThrow(/permission denied/);
      });
    }
  });
});

describe('pending_file_deletion as ping_system', () => {
  it('reads, records a failed attempt on, and deletes queued files', async () => {
    const { file } = await attachedFile('public');
    await asOwner((query) => query(queue, [file.objectKey]));
    await asPingSystem(async (query) => {
      const read = await query<{ object_key: string }>(
        'select object_key from pending_file_deletion where object_key = $1',
        [file.objectKey],
      );
      expect(read.rows).toEqual([{ object_key: file.objectKey }]);
      const failed = await query(
        `update pending_file_deletion set attempts = attempts + 1, last_error = 'timeout'
          where object_key = $1`,
        [file.objectKey],
      );
      expect(failed.rowCount).toBe(1);
      const done = await query('delete from pending_file_deletion where object_key = $1', [
        file.objectKey,
      ]);
      expect(done.rowCount).toBe(1);
    });
  });

  it('queues the file of a pending Attachment it sweeps', async () => {
    await asPingSystem(async (query) => {
      expect((await query(queue, [randomUUID()])).rowCount).toBe(1);
    });
  });
});
