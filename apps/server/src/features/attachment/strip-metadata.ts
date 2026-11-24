// The metadata stripper (product.md › Attachments). It removes every metadata segment,
// GPS included, from a JPEG, PNG, WebP or GIF by copying the file's structure and leaving
// the metadata out. It never decodes the image, so it needs little more memory than the
// file itself and runs in the 256 MB prod Machine. Each format keeps an allowlist of what
// the picture needs; everything else is dropped, including anything it doesn't know.
//
// Other files are returned unchanged.

/** The file claims to be an image but its structure is broken, so it can't be stripped. */
export class DamagedImageError extends Error {
  constructor() {
    super('The image is damaged');
    this.name = 'DamagedImageError';
  }
}

const damaged = (): never => {
  throw new DamagedImageError();
};

/** Concatenates the kept pieces of the input, each a view into it. */
function join(pieces: Uint8Array[]): Uint8Array {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out;
}

const byteAt = (content: Uint8Array, offset: number): number =>
  offset < content.length ? (content[offset] ?? 0) : damaged();

const u16be = (content: Uint8Array, offset: number) =>
  (byteAt(content, offset) << 8) | byteAt(content, offset + 1);

const u32be = (content: Uint8Array, offset: number) =>
  u16be(content, offset) * 0x10000 + u16be(content, offset + 2);

const u32le = (content: Uint8Array, offset: number) =>
  byteAt(content, offset) +
  (byteAt(content, offset + 1) << 8) +
  (byteAt(content, offset + 2) << 16) +
  byteAt(content, offset + 3) * 0x1000000;

const text = (content: Uint8Array, start: number, end: number) =>
  end <= content.length ? String.fromCharCode(...content.subarray(start, end)) : damaged();

/** A slice that must lie inside the file. */
const take = (content: Uint8Array, start: number, end: number) =>
  end <= content.length ? content.subarray(start, end) : damaged();

// JPEG ------------------------------------------------------------------------------------

const SOS = 0xda;
const EOI = 0xd9;
/** APP0 is kept only as the plain JFIF header; APP14 (Adobe) is needed to decode CMYK. */
const APP0 = 0xe0;
const APP14 = 0xee;

/** Markers with no length: TEM and the restart markers. */
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/** APP1 to APP15 (Exif, XMP, ICC, Photoshop IPTC and the rest) and COM are metadata. */
function isJpegMetadata(content: Uint8Array, marker: number, dataStart: number): boolean {
  if (marker === 0xfe) return true;
  if (marker === APP0) return text(content, dataStart, dataStart + 5) !== 'JFIF\0';
  return marker > APP0 && marker <= 0xef && marker !== APP14;
}

/** The end of a scan's entropy-coded data: the next marker that isn't FF00 or a restart. */
function scanEnd(content: Uint8Array, from: number): number {
  for (let offset = from; offset + 1 < content.length; offset += 1) {
    if (content[offset] !== 0xff) continue;
    const next = content[offset + 1] ?? 0;
    if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) return offset;
  }
  return damaged();
}

function stripJpeg(content: Uint8Array): Uint8Array {
  if (u16be(content, 0) !== 0xffd8) damaged();
  const pieces = [content.subarray(0, 2)];
  let offset = 2;
  for (;;) {
    if (byteAt(content, offset) !== 0xff) damaged();
    // Fill bytes: any number of FFs may come before a marker.
    while (byteAt(content, offset + 1) === 0xff) offset += 1;
    const marker = byteAt(content, offset + 1);
    if (marker === EOI) {
      // Anything after EOI (some cameras append data there) is dropped.
      pieces.push(content.subarray(offset, offset + 2));
      return join(pieces);
    }
    if (standalone(marker)) {
      pieces.push(content.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = u16be(content, offset + 2);
    if (length < 2) damaged();
    const end = offset + 2 + length;
    const segment = take(content, offset, end);
    if (!isJpegMetadata(content, marker, offset + 4)) pieces.push(segment);
    offset = end;
    if (marker === SOS) {
      // The scan's data runs to the next real marker; a progressive JPEG has several scans,
      // with tables (and possibly metadata) between them.
      const dataEnd = scanEnd(content, offset);
      pieces.push(content.subarray(offset, dataEnd));
      offset = dataEnd;
    }
  }
}

// PNG -------------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The chunks a picture needs, APNG's included. Text, eXIf, iCCP, tIME and the rest go. */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'sBIT',
  'bKGD',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
]);

function stripPng(content: Uint8Array): Uint8Array {
  if (!PNG_SIGNATURE.every((byte, index) => content[index] === byte)) damaged();
  const pieces = [content.subarray(0, 8)];
  for (let offset = 8; ; ) {
    const length = u32be(content, offset);
    const type = text(content, offset + 4, offset + 8);
    const end = offset + 12 + length;
    const chunk = take(content, offset, end);
    // Chunks are copied whole, so their CRCs stay valid.
    if (PNG_KEEP.has(type)) pieces.push(chunk);
    if (type === 'IEND') return join(pieces);
    offset = end;
  }
}

// WebP ------------------------------------------------------------------------------------

/** The chunks a picture needs. EXIF, XMP, ICCP and unknown chunks go. */
const WEBP_KEEP = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF']);
/** VP8X flags for the dropped chunks: ICC profile, Exif and XMP. */
const VP8X_METADATA_FLAGS = 0x20 | 0x08 | 0x04;

function stripWebp(content: Uint8Array): Uint8Array {
  if (text(content, 0, 4) !== 'RIFF' || text(content, 8, 12) !== 'WEBP') damaged();
  const riffEnd = 8 + u32le(content, 4);
  if (riffEnd > content.length) damaged();
  const chunks: Uint8Array[] = [];
  for (let offset = 12; offset < riffEnd; ) {
    const fourcc = text(content, offset, offset + 4);
    const size = u32le(content, offset + 4);
    // Chunks are padded to an even length.
    const end = offset + 8 + size + (size % 2);
    const chunk = take(content, offset, Math.min(end, riffEnd));
    if (fourcc === 'VP8X') {
      const copy = chunk.slice();
      copy[8] = byteAt(copy, 8) & ~VP8X_METADATA_FLAGS;
      chunks.push(copy);
    } else if (WEBP_KEEP.has(fourcc)) {
      chunks.push(chunk);
    }
    offset = end;
  }
  const body = join(chunks);
  const header = new Uint8Array(12);
  header.set(content.subarray(0, 4));
  const size = 4 + body.length;
  header.set([size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff], 4);
  header.set(content.subarray(8, 12), 8);
  return join([header, body]);
}

// GIF -------------------------------------------------------------------------------------

const EXTENSION = 0x21;
const IMAGE = 0x2c;
const TRAILER = 0x3b;
const APPLICATION = 0xff;
/** Animation loops; every other application extension (XMP among them) goes. */
const GIF_KEEP_APPLICATIONS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);
/** Graphic control (frame timing, transparency) and plain text are part of the picture. */
const GIF_KEEP_EXTENSIONS = new Set([0xf9, 0x01]);

/** The offset after a run of data sub-blocks and its zero terminator. */
function afterSubBlocks(content: Uint8Array, from: number): number {
  let offset = from;
  for (let size = byteAt(content, offset); size !== 0; size = byteAt(content, offset)) {
    offset += 1 + size;
  }
  return offset + 1;
}

const colorTableSize = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);

function stripGif(content: Uint8Array): Uint8Array {
  const version = text(content, 0, 6);
  if (version !== 'GIF87a' && version !== 'GIF89a') damaged();
  // Header, logical screen descriptor and global colour table.
  let offset = 13 + colorTableSize(byteAt(content, 10));
  const pieces = [take(content, 0, offset)];
  for (;;) {
    const introducer = byteAt(content, offset);
    if (introducer === TRAILER) {
      pieces.push(content.subarray(offset, offset + 1));
      return join(pieces);
    }
    if (introducer === IMAGE) {
      const tableEnd = offset + 10 + colorTableSize(byteAt(content, offset + 9));
      // After the descriptor and local colour table: the LZW code size, then the data.
      const end = afterSubBlocks(content, tableEnd + 1);
      pieces.push(take(content, offset, end));
      offset = end;
      continue;
    }
    if (introducer !== EXTENSION) damaged();
    const label = byteAt(content, offset + 1);
    const end = afterSubBlocks(content, offset + 2);
    const block = take(content, offset, end);
    const keep =
      label === APPLICATION
        ? GIF_KEEP_APPLICATIONS.has(text(content, offset + 3, offset + 14))
        : GIF_KEEP_EXTENSIONS.has(label);
    if (keep) pieces.push(block);
    offset = end;
  }
}

// -----------------------------------------------------------------------------------------

const STRIPPERS: Record<string, (content: Uint8Array) => Uint8Array> = {
  'image/jpeg': stripJpeg,
  'image/png': stripPng,
  'image/webp': stripWebp,
  'image/gif': stripGif,
};

/**
 * The file without its metadata, for the four image types; any other file unchanged.
 * Throws DamagedImageError when an image's structure is broken.
 */
export function stripImageMetadata(content: Uint8Array, contentType: string): Uint8Array {
  const strip = STRIPPERS[contentType];
  return strip ? strip(content) : content;
}
