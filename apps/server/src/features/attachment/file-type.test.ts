import { ATTACHMENT_MESSAGES } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import { detectAttachmentType } from './file-type';

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part),
    ),
  );

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'rest of a JPEG');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest of a PNG');
const WEBP = bytes('RIFF', [0x20, 0, 0, 0], 'WEBPVP8 ', 'rest');
const GIF = bytes('GIF89a', 'rest of a GIF');
const PDF = bytes('%PDF-1.7\n', 'rest of a PDF');
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], 'rest of a zip');
/** An OpenDocument file: a zip whose first entry is `mimetype`, stored, holding the type. */
const odf = (type: string) =>
  bytes([0x50, 0x4b, 0x03, 0x04], 'x'.repeat(26), 'mimetype', type, 'rest');

describe('detectAttachmentType', () => {
  it.each([
    ['photo.jpg', JPEG, 'image/jpeg', true],
    ['photo.JPEG', JPEG, 'image/jpeg', true],
    ['chart.png', PNG, 'image/png', true],
    ['sticker.webp', WEBP, 'image/webp', true],
    ['wave.gif', GIF, 'image/gif', true],
    ['old.gif', bytes('GIF87a', 'rest'), 'image/gif', true],
    ['rota.pdf', PDF, 'application/pdf', false],
    [
      'letter.docx',
      ZIP,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      false,
    ],
    ['sums.xlsx', ZIP, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
    [
      'deck.pptx',
      ZIP,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      false,
    ],
    [
      'letter.odt',
      odf('application/vnd.oasis.opendocument.text'),
      'application/vnd.oasis.opendocument.text',
      false,
    ],
    [
      'sums.ods',
      odf('application/vnd.oasis.opendocument.spreadsheet'),
      'application/vnd.oasis.opendocument.spreadsheet',
      false,
    ],
    [
      'deck.odp',
      odf('application/vnd.oasis.opendocument.presentation'),
      'application/vnd.oasis.opendocument.presentation',
      false,
    ],
    ['notes.txt', Buffer.from('Café opens at 9.\n', 'utf8'), 'text/plain', false],
    ['list.csv', Buffer.from('name,room\nMarta,2\n', 'utf8'), 'text/csv', false],
  ])('accepts %s as %s', (filename, content, contentType, isImage) => {
    expect(detectAttachmentType(filename, content)).toEqual({ ok: true, contentType, isImage });
  });

  it('refuses HEIC by name with its own message', () => {
    const heic = bytes([0, 0, 0, 0x18], 'ftypheic', 'rest');
    expect(detectAttachmentType('IMG_0001.HEIC', heic)).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.heic,
    });
    expect(detectAttachmentType('IMG_0001.heif', heic)).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.heic,
    });
  });

  it.each([
    ['setup.exe', bytes('MZ', 'rest')],
    ['page.html', Buffer.from('<html></html>')],
    ['drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['no-extension', PDF],
    ['.pdf', PDF],
  ])('refuses a type that isn’t allowed: %s', (filename, content) => {
    expect(detectAttachmentType(filename, content)).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.notAllowed,
    });
  });

  it.each([
    ['a PNG named .jpg', 'photo.jpg', PNG],
    ['a JPEG named .png', 'chart.png', JPEG],
    ['HTML named .gif', 'wave.gif', Buffer.from('<script>alert(1)</script>')],
    ['a PDF named .docx', 'letter.docx', PDF],
    ['a plain zip named .odt', 'letter.odt', ZIP],
    [
      'a spreadsheet named .odt',
      'letter.odt',
      odf('application/vnd.oasis.opendocument.spreadsheet'),
    ],
    ['a RIFF that isn’t WebP named .webp', 'sticker.webp', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt ')],
    ['binary named .txt', 'notes.txt', bytes([0x4d, 0x5a, 0x00, 0x01])],
    ['invalid UTF-8 named .csv', 'list.csv', bytes([0x61, 0xff, 0xfe, 0x62])],
    ['a too-short file named .png', 'chart.png', bytes([0x89, 0x50])],
  ])('refuses %s: magic bytes must match the extension', (_case, filename, content) => {
    expect(detectAttachmentType(filename, content)).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.mismatch,
    });
  });
});
