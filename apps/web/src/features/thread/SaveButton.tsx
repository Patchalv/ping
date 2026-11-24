import { BookmarkIcon } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { useSaveThread } from './api';

/**
 * Save a Thread to your Saved list, or remove it. Saving Acknowledges its Ping; removing
 * leaves any Ping alone. Pressed, it's also the Thread's Saved marker.
 */
export function SaveButton({
  thread,
  className,
}: {
  thread: { id: string; channelId: string; title: string; isSaved: boolean };
  className?: string;
}) {
  const save = useSaveThread();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(thread.isSaved && 'text-primary', className)}
      aria-pressed={thread.isSaved}
      aria-label={`Save ${thread.title}`}
      title={thread.isSaved ? 'Saved. Click to remove it from Saved.' : 'Save for later'}
      disabled={save.isPending}
      onClick={() =>
        save.mutate({ channelId: thread.channelId, threadId: thread.id, save: !thread.isSaved })
      }
    >
      <BookmarkIcon aria-hidden="true" className={thread.isSaved ? 'fill-current' : undefined} />
      <span>{thread.isSaved ? 'Saved' : 'Save'}</span>
    </Button>
  );
}
