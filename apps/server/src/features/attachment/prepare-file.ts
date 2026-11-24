// A file on its way into storage (product.md › Attachments): an allowed type, checked by
// its magic bytes as well as its extension, and every image's metadata stripped, whatever
// the browser did. A refusal is a ValidationError on the form's `file` field.
import { shortenFilename } from '@ping/shared';
import { ValidationError } from '../../lib/errors';
import { detectAttachmentType } from './file-type';
import { DamagedImageError, stripImageMetadata } from './strip-metadata';

export const fileIssue = (message: string) =>
  new ValidationError(message, [{ path: 'file', message }]);

/** The file as it will be stored: its kept name, the detected type, and the content. */
export function prepareFile(file: { name: string }, content: Uint8Array) {
  const filename = shortenFilename(file.name);
  const detected = detectAttachmentType(filename, content);
  if (!detected.ok) throw fileIssue(detected.message);
  try {
    const stripped = stripImageMetadata(content, detected.contentType);
    return { filename, contentType: detected.contentType, content: stripped };
  } catch (error) {
    if (error instanceof DamagedImageError) {
      throw fileIssue('This image is damaged, so Ping can’t take it. Choose another.');
    }
    throw error;
  }
}
