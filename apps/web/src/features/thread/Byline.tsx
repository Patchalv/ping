import type { ThreadAuthor } from '@ping/shared';
import { Badge } from '#/components/ui/badge';
import { formatPostedAt } from '#/lib/format-time';
import { cn } from '#/lib/utils';
import { PingMark } from '../../components/PingMark';
import { StaffAvatar } from '../../components/StaffAvatar';

/**
 * Who started a Thread, and when: on its row and in its panel. A System thread comes from
 * Ping; a Deactivated author shows greyed with a label.
 */
export function Byline({ author, at }: { author: ThreadAuthor | null; at: string }) {
  const time = (
    <time dateTime={at} className="text-xs text-muted-foreground">
      {formatPostedAt(at)}
    </time>
  );
  if (!author) {
    return (
      <div className="flex items-center gap-2">
        <PingMark className="size-6" />
        <span className="text-small font-semibold">Ping</span>
        {time}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StaffAvatar
        staff={{ id: author.staffId, name: author.name }}
        size="sm"
        tone={author.isDeactivated ? 'deactivated' : 'active'}
      />
      <span
        className={cn(
          'truncate text-small font-semibold',
          author.isDeactivated && 'text-muted-foreground',
        )}
      >
        {author.name}
      </span>
      {author.isDeactivated ? <Badge variant="tag">Deactivated</Badge> : null}
      {time}
    </div>
  );
}
