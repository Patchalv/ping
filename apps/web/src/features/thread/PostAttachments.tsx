// A Thread's or Thread Response's Attachments in the Thread view, with the confirmation
// before one is removed.
import type { PostedAttachmentView, RemovedAttachmentView } from '@ping/shared';
import { useState } from 'react';
import { AttachmentList } from '#/components/attachments/AttachmentList';
import { RemoveAttachmentDialog } from './DeleteDialogs';

export function PostAttachments({
  channelId,
  threadId,
  attachments,
  removed,
}: {
  channelId: string;
  threadId: string;
  attachments: readonly PostedAttachmentView[];
  removed: readonly RemovedAttachmentView[];
}) {
  const [removing, setRemoving] = useState<PostedAttachmentView | null>(null);
  return (
    <>
      <AttachmentList attachments={attachments} removed={removed} onRemove={setRemoving} />
      {removing ? (
        <RemoveAttachmentDialog
          channelId={channelId}
          threadId={threadId}
          attachment={removing}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}
