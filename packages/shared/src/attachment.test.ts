import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MESSAGES,
  addAttachmentForm,
  attachmentIds,
  fileExtension,
  formatFileSize,
  shortenFilename,
} from './attachment';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message);

describe('attachmentIds', () => {
  it('defaults to none', () => {
    expect(attachmentIds.parse(undefined)).toEqual([]);
  });

  it('takes up to 5 Attachments', () => {
    const five = [1, 2, 3, 4, 5].map(id);
    expect(attachmentIds.parse(five)).toEqual(five);
  });

  it('refuses a sixth, with the limit in the message', () => {
    expect(messages(attachmentIds.safeParse([1, 2, 3, 4, 5, 6].map(id)))).toEqual([
      ATTACHMENT_MESSAGES.tooMany,
    ]);
  });

  it('refuses the same Attachment twice, and anything that isn’t an ID', () => {
    expect(messages(attachmentIds.safeParse([id(1), id(1)]))).toEqual(['Attach each file once.']);
    expect(messages(attachmentIds.safeParse(['rota.pdf']))).toEqual(['That isn’t an Attachment.']);
  });
});

describe('addAttachmentForm', () => {
  const file = (name: string, size: number) => ({
    name,
    size,
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  it('takes one file', () => {
    expect(addAttachmentForm.safeParse({ file: file('rota.pdf', 12) }).success).toBe(true);
  });

  it.each([
    ['no file', undefined, 'Choose a file to attach.'],
    ['a string', 'rota.pdf', 'Choose a file to attach.'],
    ['an empty file', file('rota.pdf', 0), ATTACHMENT_MESSAGES.empty],
    ['a file over 20 MB', file('rota.pdf', ATTACHMENT_MAX_BYTES + 1), ATTACHMENT_MESSAGES.tooLarge],
    ['a file with no name', file(' ', 12), ATTACHMENT_MESSAGES.noName],
  ])('refuses %s', (_case, value, message) => {
    expect(messages(addAttachmentForm.safeParse({ file: value }))).toEqual([message]);
  });

  it('takes a file of exactly 20 MB', () => {
    expect(addAttachmentForm.safeParse({ file: file('a.pdf', ATTACHMENT_MAX_BYTES) }).success).toBe(
      true,
    );
  });
});

describe('fileExtension', () => {
  it.each([
    ['photo.JPG', 'jpg'],
    ['report.final.pdf', 'pdf'],
    ['README', ''],
    ['.env', ''],
  ])('%s → %s', (name, extension) => {
    expect(fileExtension(name)).toBe(extension);
  });
});

describe('shortenFilename', () => {
  it('trims spaces and keeps a short name', () => {
    expect(shortenFilename('  rota.pdf ')).toBe('rota.pdf');
  });

  it('cuts a long name to 255 characters, keeping its extension', () => {
    const shortened = shortenFilename(`${'a'.repeat(300)}.xlsx`);
    expect(shortened).toHaveLength(255);
    expect(shortened.endsWith('a.xlsx')).toBe(true);
  });
});

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [3.4 * 1024 * 1024, '3.4 MB'],
  ])('%d bytes is %s', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});
