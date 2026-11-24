// The Attachment sweepers (data-model.md › Housekeeping), as ping_system: work with no
// signed-in Staff member behind it (ADR 0004).
//
// - sweepPendingUploads deletes pending Attachments never posted within 24 hours, and
//   queues their files in the same transaction.
// - sweepFiles deletes queued files from object storage, then their queue rows. A failure
//   counts an attempt and keeps the error, and the next sweep tries again, because a
//   database transaction can't include object storage.
//
// startSweepers runs both in the server process, every few minutes. Heartbeats arrive with
// monitoring (#53).
import { asc, eq, sql } from 'drizzle-orm';
import { schema } from '../db';
import type { Storage } from '../lib/storage/storage';
import type { SystemActions } from './index';

const { attachment, pendingFileDeletion } = schema;

/** How many queued files one sweep takes. */
const FILE_BATCH = 50;
/** How long a pending Attachment may wait for its post (product.md › Attachments). */
const PENDING_HOURS = 24;
/** How much of a failure's message the queue keeps. */
const ERROR_MAX = 1000;

/**
 * Deletes up to `limit` queued files, oldest first. Rows another server is sweeping are
 * skipped, so two Machines never take the same file. Deleting a file that's already gone
 * succeeds, so a retry after a crash is safe.
 */
export async function sweepFiles(
  deps: { systemActions: SystemActions; storage: Pick<Storage, 'delete'> },
  { limit = FILE_BATCH }: { limit?: number } = {},
): Promise<{ deleted: number; failed: number }> {
  return deps.systemActions.db.transaction(async (tx) => {
    const queued = await tx
      .select({ objectKey: pendingFileDeletion.objectKey })
      .from(pendingFileDeletion)
      .orderBy(asc(pendingFileDeletion.requestedAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    let deleted = 0;
    let failed = 0;
    for (const { objectKey } of queued) {
      try {
        await deps.storage.delete(objectKey);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await tx
          .update(pendingFileDeletion)
          .set({
            attempts: sql`${pendingFileDeletion.attempts} + 1`,
            lastError: message.slice(0, ERROR_MAX),
          })
          .where(eq(pendingFileDeletion.objectKey, objectKey));
        continue;
      }
      deleted += 1;
      await tx.delete(pendingFileDeletion).where(eq(pendingFileDeletion.objectKey, objectKey));
    }
    return { deleted, failed };
  });
}

/**
 * Deletes pending Attachments older than 24 hours and queues their files, in one
 * statement. ping_system's policy reaches pending Attachments only.
 */
export async function sweepPendingUploads(deps: {
  systemActions: SystemActions;
}): Promise<{ swept: number }> {
  const result = await deps.systemActions.db.execute(sql`
    with swept as (
      delete from ${attachment}
       where ${attachment.channelId} is null
         and ${attachment.createdAt} < now() - make_interval(hours => ${PENDING_HOURS})
      returning ${attachment.objectKey} as object_key)
    insert into ${pendingFileDeletion} (object_key)
    select object_key from swept
    on conflict do nothing`);
  return { swept: result.rowCount ?? 0 };
}

/** How often the sweepers run. */
const SWEEP_EVERY_MS = 5 * 60 * 1000;

/**
 * Runs both sweepers every few minutes, one sweep at a time, until stopped. Files are
 * swept only where storage is set up. A failed sweep goes to `reportError` and the next
 * one tries again.
 */
export function startSweepers(deps: {
  systemActions: SystemActions;
  storage: Pick<Storage, 'delete'> | undefined;
  reportError: (error: unknown) => void;
}): { stop(): void } {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await sweepPendingUploads(deps);
      if (deps.storage) await sweepFiles({ ...deps, storage: deps.storage });
    } catch (error) {
      deps.reportError(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), SWEEP_EVERY_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
