// Attachments on a Thread or Thread Response: images inline, other files as chips. Each
// opens through Ping's server, which checks the viewer can read the Thread and then
// redirects to a short-lived signed link (product.md › Attachments). That's a plain link
// the browser follows, not an API call.
import {
  type AttachmentView,
  formatFileSize,
  type PostedAttachmentView,
  type RemovedAttachmentView,
} from '@ping/shared';
import { FileTextIcon, ImageIcon, XIcon } from 'lucide-react';

const href = (attachment: AttachmentView) =>
  `/api/attachments/${encodeURIComponent(attachment.id)}`;

/** The small button that asks to remove an Attachment. */
function RemoveButton({ attachment, onRemove }: { attachment: AttachmentView; onRemove(): void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${attachment.filename}`}
      title="Remove"
      onClick={onRemove}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
    >
      <XIcon aria-hidden="true" className="size-4" />
    </button>
  );
}

/**
 * Every Attachment on a post, under its text, then the placeholders of removed ones. Those
 * the viewer may remove carry a Remove button, which calls `onRemove`.
 */
export function AttachmentList({
  attachments,
  removed,
  onRemove,
}: {
  attachments: readonly PostedAttachmentView[];
  removed: readonly RemovedAttachmentView[];
  onRemove(attachment: PostedAttachmentView): void;
}) {
  if (attachments.length === 0 && removed.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.isImage);
  const files = attachments.filter((attachment) => !attachment.isImage);
  return (
    <div className="mt-2 grid gap-2">
      {images.length > 0 ? (
        <ul aria-label="Images" className="flex flex-wrap gap-2">
          {images.map((image) => (
            <li key={image.id} className="relative">
              <a
                href={href(image)}
                target="_blank"
                rel="noopener"
                className="block overflow-hidden rounded-lg border focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
              >
                <img
                  src={href(image)}
                  alt={image.filename}
                  loading="lazy"
                  className="h-40 max-w-full bg-muted object-contain sm:h-48"
                />
              </a>
              {image.canRemove ? (
                <div className="absolute top-1.5 right-1.5 rounded-md bg-card/90 shadow-sm">
                  <RemoveButton attachment={image} onRemove={() => onRemove(image)} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul aria-label="Files" className="flex flex-wrap gap-2">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-0.5">
              <a
                href={href(file)}
                className="flex max-w-72 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
              >
                <FileTextIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate font-medium">{file.filename}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(file.sizeBytes)}
                </span>
              </a>
              {file.canRemove ? (
                <RemoveButton attachment={file} onRemove={() => onRemove(file)} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {removed.length > 0 ? (
        <ul aria-label="Removed Attachments" className="grid gap-1">
          {removed.map((placeholder) => (
            <li key={placeholder.id} className="text-sm text-muted-foreground italic">
              Attachment removed by {placeholder.removedByName}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A Thread row's first Attachments, by name, and how many more there are. */
export function AttachmentSummary({
  attachments,
  count,
}: {
  attachments: readonly AttachmentView[];
  count: number;
}) {
  if (count === 0) return null;
  const more = count - attachments.length;
  return (
    <ul aria-label="Attachments" className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {attachments.map((attachment) => {
        const Icon = attachment.isImage ? ImageIcon : FileTextIcon;
        return (
          <li
            key={attachment.id}
            className="flex max-w-48 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{attachment.filename}</span>
          </li>
        );
      })}
      {more > 0 ? <li className="text-xs text-muted-foreground">+{more} more</li> : null}
    </ul>
  );
}
