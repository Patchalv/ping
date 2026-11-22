import type { ReactionSummary } from '@ping/shared';
import { SmilePlusIcon } from 'lucide-react';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { cn } from '#/lib/utils';
import { useReact } from './api';

/** The emoji the picker offers. */
const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🔥', '😮', '😢', '👏', '🚀'];

const reactionLabel = ({ emoji, count, reacted }: ReactionSummary) =>
  `${emoji}, ${count === 1 ? '1 person' : `${count} people`}${reacted ? ', including you' : ''}`;

/**
 * The reactions on a Thread, or on a Thread Response when `threadResponseId` is given: a
 * chip per emoji with its count (press to add yours or take it back), and an "Add
 * reaction" picker. Staff members who can't react (not in the Channel, or it's archived)
 * see the counts only.
 */
export function Reactions({
  channelId,
  threadId,
  threadResponseId,
  reactions,
  canReact,
  className,
}: {
  channelId: string;
  threadId: string;
  threadResponseId?: string;
  reactions: ReactionSummary[];
  canReact: boolean;
  className?: string;
}) {
  const react = useReact(channelId, threadId, { threadResponseId });
  if (reactions.length === 0 && !canReact) return null;

  const toggle = (emoji: string) => {
    const reacted = reactions.some((r) => r.emoji === emoji && r.reacted);
    react.mutate({ emoji, add: !reacted });
  };

  return (
    <div className={cn('mt-2', className)}>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Reactions">
        {reactions.map((reaction) => (
          <li key={reaction.emoji}>
            {canReact ? (
              <button
                type="button"
                aria-pressed={reaction.reacted}
                aria-label={reactionLabel(reaction)}
                disabled={react.isPending}
                onClick={() => toggle(reaction.emoji)}
                className={chipClass(reaction.reacted)}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span aria-hidden="true" className="tabular-nums">
                  {reaction.count}
                </span>
              </button>
            ) : (
              <span role="img" aria-label={reactionLabel(reaction)} className={chipClass(false)}>
                <span aria-hidden="true">{reaction.emoji}</span>
                <span aria-hidden="true" className="tabular-nums">
                  {reaction.count}
                </span>
              </span>
            )}
          </li>
        ))}
        {canReact ? (
          <li>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Add reaction" />}
              >
                <SmilePlusIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <div className="grid grid-cols-6 gap-0.5">
                  {QUICK_EMOJI.map((emoji) => (
                    <DropdownMenuItem
                      key={emoji}
                      aria-label={`React with ${emoji}`}
                      onClick={() => toggle(emoji)}
                      className="justify-center px-0 py-1.5 text-lg"
                    >
                      {emoji}
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ) : null}
      </ul>
      {react.isError ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {react.error.message}
        </p>
      ) : null}
    </div>
  );
}

const chipClass = (reacted: boolean) =>
  cn(
    'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-small outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-md:h-9',
    reacted
      ? 'border-primary/50 bg-primary/10 text-foreground'
      : 'border-border bg-background text-muted-foreground',
    'disabled:opacity-60 [button&]:hover:bg-muted',
  );
