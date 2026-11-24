// The allowed-type check (product.md › Attachments): the extension must be on the allowed
// list, and the file's magic bytes must agree with it. The server stores the type it
// detected, never the one the browser claimed.
import { ALLOWED_ATTACHMENT_TYPES, ATTACHMENT_MESSAGES, fileExtension } from '@ping/shared';

export type DetectedType =
  | { ok: true; contentType: string; isImage: boolean }
  | { ok: false; message: string };

const startsWith = (content: Uint8Array, signature: readonly number[], at = 0) =>
  content.length >= at + signature.length &&
  signature.every((byte, index) => content[at + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * An OpenDocument file is a zip whose first entry is an uncompressed `mimetype` file
 * holding the document's type, so the type sits at a fixed offset: the 30-byte local file
 * header, then the 8-byte name.
 */
const isOpenDocument = (content: Uint8Array, contentType: string) =>
  startsWith(content, ZIP) &&
  startsWith(content, ascii('mimetype'), 30) &&
  startsWith(content, ascii(contentType), 38);

/** Text has no magic bytes: it must be valid UTF-8 with no NUL bytes. */
function isText(content: Uint8Array): boolean {
  if (content.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

/** Whether the content's magic bytes match what an allowed extension says it is. */
function matches(extension: string, contentType: string, content: Uint8Array): boolean {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return startsWith(content, [0xff, 0xd8, 0xff]);
    case 'png':
      return startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'webp':
      return startsWith(content, ascii('RIFF')) && startsWith(content, ascii('WEBP'), 8);
    case 'gif':
      return startsWith(content, ascii('GIF87a')) || startsWith(content, ascii('GIF89a'));
    case 'pdf':
      return startsWith(content, ascii('%PDF-'));
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return startsWith(content, ZIP);
    case 'odt':
    case 'ods':
    case 'odp':
      return isOpenDocument(content, contentType);
    case 'txt':
    case 'csv':
      return isText(content);
    default:
      return false;
  }
}

/** The type to store a file as, or the message saying why it can't be attached. */
export function detectAttachmentType(filename: string, content: Uint8Array): DetectedType {
  const extension = fileExtension(filename);
  if (extension === 'heic' || extension === 'heif') {
    return { ok: false, message: ATTACHMENT_MESSAGES.heic };
  }
  const allowed = Object.hasOwn(ALLOWED_ATTACHMENT_TYPES, extension)
    ? ALLOWED_ATTACHMENT_TYPES[extension]
    : undefined;
  if (!allowed) return { ok: false, message: ATTACHMENT_MESSAGES.notAllowed };
  if (!matches(extension, allowed.contentType, content)) {
    return { ok: false, message: ATTACHMENT_MESSAGES.mismatch };
  }
  return { ok: true, ...allowed };
}
