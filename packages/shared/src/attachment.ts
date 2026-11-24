// Attachments (product.md › Attachments): the fixed limits and allowed types both apps use,
// the request schemas, and the shapes the server answers with.
import { z } from 'zod';

/** 20 MB per file, fixed in code for the MVP. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** 5 files per Thread or Thread Response, fixed in code for the MVP. */
export const ATTACHMENTS_PER_POST_MAX = 5;
/** Images are resized in the browser to about this many pixels on the long edge. */
export const IMAGE_MAX_EDGE = 2048;

/** What the server stores a file as, by the extension it must carry. */
type AllowedType = { contentType: string; isImage: boolean };

const OOXML = 'application/vnd.openxmlformats-officedocument';
const ODF = 'application/vnd.oasis.opendocument';

/**
 * The allowed types, fixed in code: JPEG, PNG, WebP, GIF, PDF, Word, Excel and PowerPoint
 * (OOXML), OpenDocument, TXT and CSV. The server checks magic bytes as well.
 */
export const ALLOWED_ATTACHMENT_TYPES: Readonly<Record<string, AllowedType>> = {
  jpg: { contentType: 'image/jpeg', isImage: true },
  jpeg: { contentType: 'image/jpeg', isImage: true },
  png: { contentType: 'image/png', isImage: true },
  webp: { contentType: 'image/webp', isImage: true },
  gif: { contentType: 'image/gif', isImage: true },
  pdf: { contentType: 'application/pdf', isImage: false },
  docx: { contentType: `${OOXML}.wordprocessingml.document`, isImage: false },
  xlsx: { contentType: `${OOXML}.spreadsheetml.sheet`, isImage: false },
  pptx: { contentType: `${OOXML}.presentationml.presentation`, isImage: false },
  odt: { contentType: `${ODF}.text`, isImage: false },
  ods: { contentType: `${ODF}.spreadsheet`, isImage: false },
  odp: { contentType: `${ODF}.presentation`, isImage: false },
  txt: { contentType: 'text/plain', isImage: false },
  csv: { contentType: 'text/csv', isImage: false },
};

/** Whether a stored type is one of the images, which open inline and show as previews. */
export const isImageType = (contentType: string) => contentType.startsWith('image/');

/** The file picker's `accept` list: every allowed extension. */
export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED_ATTACHMENT_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');

/** The lower-cased extension of a filename, or '' when it has none. */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

export const ATTACHMENT_MESSAGES = {
  tooLarge: 'Keep each file to 20 MB or smaller.',
  empty: 'This file is empty. Choose another.',
  tooMany: `Attach up to ${ATTACHMENTS_PER_POST_MAX} files to each Thread or Thread Response.`,
  heic: 'Ping can’t take HEIC photos. Save the photo as JPEG and attach it again.',
  notAllowed:
    'Ping can’t take this kind of file. Attach images (JPEG, PNG, WebP, GIF), PDFs, Office or OpenDocument files, or TXT and CSV files.',
  mismatch: 'This file isn’t what its name says. Check it, then attach it again.',
  unavailable: 'One of these Attachments is no longer available. Attach it again.',
  noName: 'Give the file a name, then attach it again.',
} as const;

const FILENAME_MAX = 255;

/**
 * A File, described by what Ping uses of it, so the schema needs neither the DOM's types
 * nor Node's.
 */
type FileLike = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

const isFileLike = (value: unknown): value is FileLike =>
  typeof value === 'object' &&
  value !== null &&
  'name' in value &&
  typeof value.name === 'string' &&
  'size' in value &&
  typeof value.size === 'number' &&
  'arrayBuffer' in value &&
  typeof value.arrayBuffer === 'function';

/** POST /api/channels/:channelId/attachments: one file, as multipart form data. */
export const addAttachmentForm = z.object({
  file: z
    .custom<FileLike>(isFileLike, { error: 'Choose a file to attach.' })
    .refine((file) => file.name.trim() !== '', ATTACHMENT_MESSAGES.noName)
    .refine((file) => file.size > 0, ATTACHMENT_MESSAGES.empty)
    .refine((file) => file.size <= ATTACHMENT_MAX_BYTES, ATTACHMENT_MESSAGES.tooLarge),
});

/** The Attachments a save adds to its Thread or Thread Response: pending ones, by ID. */
export const attachmentIds = z
  .array(z.uuid({ error: 'That isn’t an Attachment.' }), { error: 'That isn’t an Attachment.' })
  .max(ATTACHMENTS_PER_POST_MAX, ATTACHMENT_MESSAGES.tooMany)
  .refine((ids) => new Set(ids).size === ids.length, 'Attach each file once.')
  .default([]);

/** GET /api/attachments/:attachmentId: open an Attachment. */
export const attachmentParams = z.object({
  attachmentId: z.uuid({ error: 'That isn’t an Attachment.' }),
});

/** An Attachment as Thread rows, Thread views and the composer show it. */
export type AttachmentView = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
};

/** An Attachment on a post in the Thread view: whether the viewer may remove it. */
export type PostedAttachmentView = AttachmentView & { canRemove: boolean };

/**
 * The "Attachment removed by <name>" placeholder. It keeps who removed it and nothing about
 * the file, since removal is how wrongly shared personal data comes down.
 */
export type RemovedAttachmentView = { id: string; removedByName: string };

/** The longest filename kept; a longer one keeps its start and its extension. */
export function shortenFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length <= FILENAME_MAX) return trimmed;
  const extension = fileExtension(trimmed);
  const tail = extension ? `.${extension}` : '';
  return `${trimmed.slice(0, FILENAME_MAX - tail.length)}${tail}`;
}

/** "12 KB", "3.4 MB": a file size for people. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
