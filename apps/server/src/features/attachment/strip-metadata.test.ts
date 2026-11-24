import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DamagedImageError, stripImageMetadata } from './strip-metadata';

// Each fixture is a small real image carrying Exif GPS (with the camera make
// "PingTestCamera"), XMP with GPS, and a comment (fixtures/README.md).
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/with-metadata.${name}`, import.meta.url));

/** Text and byte runs that only the metadata carries. */
const TRACES = [
  'Exif',
  'PingTestCamera',
  'xmpmeta',
  'GPSLatitude',
  'Ping test comment',
  // GPSLatitude 41/1 23/1 30/1, as the Exif GPS IFD stores it.
  Buffer.from([0, 0, 0, 41, 0, 0, 0, 1, 0, 0, 0, 23, 0, 0, 0, 1]),
];

const hasTrace = (content: Buffer, trace: string | Buffer) => content.includes(trace);

const at = (content: Buffer, offset: number) => content.readUInt32BE(offset);

/** Each PNG chunk's type and its whole bytes. */
function pngChunks(content: Buffer): { type: string; bytes: Buffer }[] {
  const chunks = [];
  for (let offset = 8; offset < content.length; ) {
    const length = at(content, offset);
    const type = content.toString('latin1', offset + 4, offset + 8);
    chunks.push({ type, bytes: content.subarray(offset, offset + 12 + length) });
    offset += 12 + length;
  }
  return chunks;
}

/** Each WebP chunk's FourCC and data, after checking the RIFF size covers the file. */
function webpChunks(content: Buffer): { fourcc: string; data: Buffer }[] {
  expect(content.toString('latin1', 0, 4)).toBe('RIFF');
  expect(content.readUInt32LE(4)).toBe(content.length - 8);
  expect(content.toString('latin1', 8, 12)).toBe('WEBP');
  const chunks = [];
  for (let offset = 12; offset < content.length; ) {
    const size = content.readUInt32LE(offset + 4);
    chunks.push({
      fourcc: content.toString('latin1', offset, offset + 4),
      data: content.subarray(offset + 8, offset + 8 + size),
    });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

/** A JPEG's markers in order, up to the first scan, then the bytes from the scan on. */
function jpegLayout(content: Buffer): { markers: number[]; scan: Buffer } {
  const markers = [];
  let offset = 2;
  while (content[offset] === 0xff) {
    const marker = content[offset + 1] ?? 0;
    markers.push(marker);
    if (marker === 0xda) break;
    offset += 2 + content.readUInt16BE(offset + 2);
  }
  return { markers, scan: content.subarray(offset) };
}

describe('stripImageMetadata', () => {
  it.each([
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif'],
  ])('removes Exif GPS, XMP and the comment from a %s', (name, contentType) => {
    const input = fixture(name);
    for (const trace of TRACES.slice(1)) expect(hasTrace(input, trace)).toBe(true);

    const output = Buffer.from(stripImageMetadata(input, contentType));

    for (const trace of TRACES) expect(hasTrace(output, trace)).toBe(false);
    expect(output.length).toBeLessThan(input.length);
  });

  it('keeps a JPEG’s JFIF header, tables, frame and scan data byte for byte', () => {
    const input = fixture('jpg');
    const output = Buffer.from(stripImageMetadata(input, 'image/jpeg'));

    expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const before = jpegLayout(input);
    const after = jpegLayout(output);
    // The fixture has APP1 (Exif, XMP), APP13 (Photoshop IPTC, from the tool that made it)
    // and COM; everything else stays, APP0 (JFIF) first.
    expect(before.markers).toEqual(expect.arrayContaining([0xe1, 0xed, 0xfe]));
    expect(after.markers).toEqual(
      before.markers.filter((m) => m !== 0xe1 && m !== 0xed && m !== 0xfe),
    );
    expect(after.markers[0]).toBe(0xe0);
    expect(after.scan).toEqual(before.scan);
  });

  it('drops metadata a progressive JPEG carries between its scans', () => {
    const segment = (marker: number, data: string) =>
      Buffer.concat([
        Buffer.from([0xff, marker]),
        Buffer.from([0, data.length + 2]),
        Buffer.from(data, 'latin1'),
      ]);
    // SOI, a scan whose data has a stuffed FF00 and a restart marker, a comment between
    // scans, a second scan, EOI.
    const input = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xda, 'scan1'),
      Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
      segment(0xfe, 'Ping test comment'),
      segment(0xda, 'scan2'),
      Buffer.from([0x78]),
      Buffer.from([0xff, 0xd9]),
    ]);
    const output = Buffer.from(stripImageMetadata(input, 'image/jpeg'));
    expect(output).toEqual(
      Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        segment(0xda, 'scan1'),
        Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
        segment(0xda, 'scan2'),
        Buffer.from([0x78]),
        Buffer.from([0xff, 0xd9]),
      ]),
    );
  });

  it('keeps a PNG’s image chunks whole, CRCs and all', () => {
    const input = fixture('png');
    const output = Buffer.from(stripImageMetadata(input, 'image/png'));

    const kept = pngChunks(input).filter((c) => !['eXIf', 'iTXt', 'tEXt'].includes(c.type));
    expect(pngChunks(output)).toEqual(kept);
    expect(kept.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('keeps a WebP’s bitstream, clears the VP8X metadata flags and fixes the RIFF size', () => {
    const input = fixture('webp');
    const output = Buffer.from(stripImageMetadata(input, 'image/webp'));

    const before = webpChunks(input);
    const after = webpChunks(output);
    expect(after.map((c) => c.fourcc)).toEqual(['VP8X', 'VP8 ']);
    expect(after[1]?.data).toEqual(before.find((c) => c.fourcc === 'VP8 ')?.data);
    // Flags: no ICC (0x20), Exif (0x08) or XMP (0x04); the canvas size is unchanged.
    expect((after[0]?.data[0] ?? 0xff) & 0x2c).toBe(0);
    expect(after[0]?.data.subarray(4)).toEqual(before[0]?.data.subarray(4));
  });

  it('keeps a GIF’s screen, loop, frame control and image data', () => {
    const input = fixture('gif');
    const output = Buffer.from(stripImageMetadata(input, 'image/gif'));

    expect(output.subarray(0, 13 + 6)).toEqual(input.subarray(0, 13 + 6));
    expect(hasTrace(output, 'NETSCAPE2.0')).toBe(true);
    const image = input.subarray(input.indexOf(Buffer.from([0x21, 0xf9])));
    expect(output.subarray(output.length - image.length)).toEqual(image);
  });

  it('leaves a simple WebP without VP8X alone', () => {
    const plain = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([12, 0, 0, 0]),
      Buffer.from('WEBPVP8L'),
      Buffer.from([0, 0, 0, 0]),
    ]);
    expect(Buffer.from(stripImageMetadata(plain, 'image/webp'))).toEqual(plain);
  });

  it('leaves files that aren’t images unchanged', () => {
    const pdf = Buffer.from('%PDF-1.7\n/Author (Marta)\n');
    expect(stripImageMetadata(pdf, 'application/pdf')).toBe(pdf);
  });

  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x01])],
    ['image/png', Buffer.concat([fixture('png').subarray(0, 8), Buffer.from([0, 0, 1, 0, 0x49])])],
    ['image/gif', Buffer.from('GIF89a\x02\x00')],
    ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([90, 0, 0, 0]), Buffer.from('WEBPVP8X')])],
  ])('refuses a truncated %s instead of storing it half-stripped', (contentType, broken) => {
    expect(() => stripImageMetadata(broken, contentType)).toThrow(DamagedImageError);
  });
});

