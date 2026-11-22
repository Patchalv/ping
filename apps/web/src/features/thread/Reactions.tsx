import {
  type ReactionEmojiBody,
  type ReactionSummary,
  reactionEmojiBody,
  THUMBS_UP,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { SmilePlusIcon, ThumbsUpIcon } from 'lucide-react';
import { useState } from 'react';
import { useAppForm } from '#/components/form';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { cn } from '#/lib/utils';
import { useReact } from './api';

/** The quick picks. "Other emoji…" reaches the rest of Unicode. */
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
}: {
  channelId: string;
  threadId: string;
  threadResponseId?: string;
  reactions: ReactionSummary[];
  canReact: boolean;
}) {
  const react = useReact(channelId, threadId, { threadResponseId });
  const [pickingOther, setPickingOther] = useState(false);
  if (reactions.length === 0 && !canReact) return null;

  const toggle = (emoji: string) => {
    const reacted = reactions.some((r) => r.emoji === emoji && r.reacted);
    react.mutate({ emoji, add: !reacted });
  };

  return (
    <div className="mt-2">
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPickingOther(true)}>
                  Other emoji…
                </DropdownMenuItem>
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
      {pickingOther ? (
        <OtherEmojiDialog
          onPick={(emoji) => {
            if (!reactions.some((r) => r.emoji === emoji && r.reacted)) toggle(emoji);
          }}
          onClose={() => setPickingOther(false)}
        />
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

/** Type or paste any emoji: the keyboard's own emoji picker does the choosing. */
function OtherEmojiDialog({ onPick, onClose }: { onPick(emoji: string): void; onClose(): void }) {
  const defaultValues: ReactionEmojiBody = { emoji: '' };
  const form = useAppForm({
    formId: 'react-with-other-emoji',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: reactionEmojiBody },
    onSubmit: ({ value }) => {
      onPick(reactionEmojiBody.parse(value).emoji);
      onClose();
    },
  });

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form.AppForm>
          <form.Form className="grid gap-4">
            <DialogHeader>
              <DialogTitle>React with another emoji</DialogTitle>
              <DialogDescription>
                Open your keyboard’s emoji picker (Control + Command + Space on a Mac, Windows key +
                period on Windows) and choose one.
              </DialogDescription>
            </DialogHeader>
            <form.AppField name="emoji">
              {(field) => <field.TextField label="Emoji" autoComplete="off" className="text-lg" />}
            </form.AppField>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending="Reacting…">React</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The 👍 button on a Thread row (screens.md › Channel view): reacts to the Thread itself
 * and shows how many 👍 it has. Without permission to react it shows the count alone.
 */
export function ThumbsUpButton({
  channelId,
  threadId,
  reactions,
  canReact,
}: {
  channelId: string;
  threadId: string;
  reactions: ReactionSummary[];
  canReact: boolean;
}) {
  const react = useReact(channelId, threadId);
  const mine = reactions.find((r) => r.emoji === THUMBS_UP);
  const count = mine?.count ?? 0;
  if (!canReact) {
    return count > 0 ? (
      <span
        role="img"
        aria-label={`${count} ${count === 1 ? 'person' : 'people'} reacted with ${THUMBS_UP}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ThumbsUpIcon aria-hidden="true" className="size-3.5" />
        <span aria-hidden="true">{count}</span>
      </span>
    ) : null;
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={mine?.reacted ?? false}
      aria-label={mine?.reacted ? 'Take back your 👍' : 'React with 👍'}
      disabled={react.isPending}
      onClick={() => react.mutate({ emoji: THUMBS_UP, add: !mine?.reacted })}
      className={cn('gap-1', mine?.reacted && 'bg-primary/10 text-primary hover:bg-primary/15')}
    >
      <ThumbsUpIcon aria-hidden="true" className={cn(mine?.reacted && 'fill-current')} />
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </Button>
  );
}
