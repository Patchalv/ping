// The composer's Attachments (screens.md › Composer): files are added while the post is
// being written, with progress, and show as inline image previews or file chips. Each one
// is pending, visible only to its uploader, until the post is saved with its ID.
import {
  ALLOWED_ATTACHMENT_TYPES,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MESSAGES,
  ATTACHMENTS_PER_POST_MAX,
  type AttachmentView,
  fileExtension,
  formatFileSize,
} from '@ping/shared';
import { FileTextIcon, PaperclipIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { ApiError } from '#/lib/api-client';
import { cn } from '#/lib/utils';
import { prepareImage } from './resize-image';

/** Shown when the Staff member saves while files are still being sent. */
export const STILL_ATTACHING = 'Wait for your files to finish attaching, then try again.';

/**
 * Tracks how many files a composer is still sending, so its onSubmit can wait for them.
 * Pass `onAddingChange` to the AttachmentsField.
 */
export function useAttachingCount() {
  const adding = useRef(0);
  return {
    onAddingChange: (count: number) => {
      adding.current = count;
    },
    isAttaching: () => adding.current > 0,
  };
}

/** Adds one file, reporting the fraction sent; the feature's api.ts provides it. */
export type AddAttachment = (
  file: File,
  onProgress: (fraction: number) => void,
) => Promise<AttachmentView>;

type Item = {
  key: string;
  filename: string;
  isImage: boolean;
  /** A blob: URL of the file as sent, for an image's preview. */
  previewUrl: string | null;
  state:
    | { kind: 'waiting' }
    | { kind: 'adding'; progress: number }
    | { kind: 'added'; attachment: AttachmentView }
    | { kind: 'failed'; message: string };
};

const isImageName = (filename: string) =>
  ALLOWED_ATTACHMENT_TYPES[fileExtension(filename)]?.isImage === true;

/** The browser's own check, before anything is sent; the server checks again. */
function refusal(file: File): string | null {
  const extension = fileExtension(file.name);
  if (extension === 'heic' || extension === 'heif') return ATTACHMENT_MESSAGES.heic;
  if (!Object.hasOwn(ALLOWED_ATTACHMENT_TYPES, extension)) return ATTACHMENT_MESSAGES.notAllowed;
  if (file.size === 0) return ATTACHMENT_MESSAGES.empty;
  if (file.size > ATTACHMENT_MAX_BYTES) return ATTACHMENT_MESSAGES.tooLarge;
  return null;
}

const addedIds = (items: readonly Item[]) =>
  items.flatMap((item) => (item.state.kind === 'added' ? [item.state.attachment.id] : []));

export function AttachmentPicker({
  add,
  onChange,
  onAddingChange,
  alreadyAttached = 0,
  describedBy,
}: {
  add: AddAttachment;
  /** How many Attachments the post already has, when editing: they count toward the 5. */
  alreadyAttached?: number;
  /** The added Attachments' IDs, in the order they were picked. */
  onChange(ids: string[]): void;
  /** How many files are still being sent; the composer waits for them before saving. */
  onAddingChange(count: number): void;
  /** The field's error, when the server refused the Attachments. */
  describedBy?: string;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [items, setItems] = useState<Item[]>([]);
  // The latest items, so each file's progress and outcome update the current list.
  const itemsRef = useRef<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Files are sent one at a time, so the server only ever holds one in memory for this
  // composer (the prod Machine has 256 MB).
  const queue = useRef<Promise<void>>(Promise.resolve());

  const update = (change: (items: Item[]) => Item[]) => {
    const next = change(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    onAddingChange(
      next.filter((item) => item.state.kind === 'waiting' || item.state.kind === 'adding').length,
    );
    return next;
  };
  const setState = (key: string, state: Item['state']) =>
    update((current) => current.map((item) => (item.key === key ? { ...item, state } : item)));

  // eslint-disable-next-line no-restricted-syntax -- releases the image previews' blob: URLs, which live outside React, when the composer goes.
  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    },
    [],
  );

  /** Lists a picked file at once, in the order picked, and queues it to be sent. */
  function pick(picked: File) {
    const key = crypto.randomUUID();
    const isImage = isImageName(picked.name);
    const refused = refusal(picked);
    update((current) => [
      ...current,
      {
        key,
        filename: picked.name,
        isImage,
        previewUrl: null,
        state: refused ? { kind: 'failed', message: refused } : { kind: 'waiting' },
      },
    ]);
    if (refused) return;
    queue.current = queue.current.then(() => send(key, picked, isImage));
  }

  /** Resizes an image, then sends the file, unless it was removed while it waited. */
  async function send(key: string, picked: File, isImage: boolean) {
    if (!itemsRef.current.some((item) => item.key === key)) return;
    setState(key, { kind: 'adding', progress: 0 });
    const file = isImage ? await prepareImage(picked) : picked;
    // Removed while it was being resized: nothing to send.
    if (!itemsRef.current.some((item) => item.key === key)) return;
    if (isImage) {
      const previewUrl = URL.createObjectURL(file);
      update((current) =>
        current.map((item) => (item.key === key ? { ...item, previewUrl } : item)),
      );
    }
    try {
      const attachment = await add(file, (progress) => setState(key, { kind: 'adding', progress }));
      // Removed while it was being sent: leave it pending; it's swept after 24 hours.
      if (!itemsRef.current.some((item) => item.key === key)) return;
      onChange(addedIds(setState(key, { kind: 'added', attachment })));
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
      setState(key, { kind: 'failed', message });
    }
  }

  function remove(key: string) {
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    onChange(addedIds(update((current) => current.filter((candidate) => candidate.key !== key))));
  }

  const kept = items.filter((item) => item.state.kind !== 'failed').length;
  const room = ATTACHMENTS_PER_POST_MAX - alreadyAttached - kept;

  return (
    <div className="grid gap-2">
      {items.length > 0 ? (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.key}>
              <PickedAttachment item={item} onRemove={() => remove(item.key)} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          disabled={room <= 0}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])].slice(0, Math.max(0, room));
            // Picking the same file again must fire a change.
            event.target.value = '';
            for (const file of files) pick(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={room <= 0}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
          onClick={() => inputRef.current?.click()}
        >
          <PaperclipIcon aria-hidden="true" />
          Attach files
        </Button>
        <span id={hintId} className="text-xs text-muted-foreground">
          Up to {ATTACHMENTS_PER_POST_MAX} files, 20 MB each
        </span>
      </div>
    </div>
  );
}

function PickedAttachment({ item, onRemove }: { item: Item; onRemove(): void }) {
  const { state } = item;
  const status =
    state.kind === 'waiting'
      ? 'Waiting…'
      : state.kind === 'adding'
        ? `Attaching, ${Math.round(state.progress * 100)}%`
        : state.kind === 'failed'
          ? state.message
          : state.attachment.isImage
            ? null
            : formatFileSize(state.attachment.sizeBytes);
  return (
    <div
      className={cn(
        'relative flex max-w-72 items-center gap-2 rounded-lg border bg-card p-1.5 pr-8',
        state.kind === 'failed' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      {item.previewUrl ? (
        <img src={item.previewUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileTextIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-medium">{item.filename}</span>
        {status ? (
          <span
            className={cn(
              'text-xs',
              state.kind === 'failed' ? 'text-destructive' : 'text-muted-foreground',
            )}
            role={state.kind === 'failed' ? 'alert' : undefined}
          >
            {status}
          </span>
        ) : null}
        {state.kind === 'adding' ? (
          <span
            role="progressbar"
            aria-label={`Attaching ${item.filename}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
            className="h-1 w-32 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </span>
        ) : null}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1 right-1"
        aria-label={`Remove ${item.filename}`}
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
