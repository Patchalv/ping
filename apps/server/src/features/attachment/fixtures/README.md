# Metadata-stripper fixtures

One small real image of each type the stripper handles. Each carries:

- **Exif with GPS:** a TIFF block with the camera make `PingTestCamera` and a GPS IFD (`GPSLatitudeRef` N, `GPSLatitude` 41/1 23/1 30/1). JPEG holds it in APP1, PNG in `eXIf`, WebP in `EXIF`, and GIF (which has no Exif) in an application extension.
- **XMP** with `exif:GPSLatitude` and `exif:GPSLongitude`: JPEG APP1, PNG `iTXt`, WebP `XMP `, GIF's `XMP DataXMP` application extension.
- **A comment,** "Ping test comment: …": JPEG COM, PNG `tEXt`, GIF Comment extension. WebP has no comment chunk, so it sits in an unknown `CMNT` chunk, which decoders skip.

The JPEG also has the APP13 (Photoshop IPTC) block that macOS `sips` writes.

How they were made: a 16×16 PNG written by hand, converted to JPEG with `sips` and to WebP with `cwebp`; the GIF is a hand-written 2×2 image with a `NETSCAPE2.0` loop. A short Node script then added the metadata segments above. All four open in macOS Preview before and after stripping, and the Playwright Attachment journey (`e2e/attachment.spec.ts`) decodes the stripped copies in Chromium.
