// Images are resized in the browser to about 2048 px on the long edge, to keep uploads
// small (product.md › Attachments). JPEG and WebP are always redrawn: the browser applies
// the photo's rotation as it draws, so the picture stays upright once the server strips
// the Exif that held it. PNGs are redrawn only when too big. GIFs are left alone, because
// redrawing one would stop its animation. The server strips metadata either way.
import { fileExtension, IMAGE_MAX_EDGE } from '@ping/shared';

type Size = { width: number; height: number };

/** The size that fits within `maxEdge` on the long edge, keeping the shape. */
export function fitWithin(width: number, height: number, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const ALWAYS = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
]);

/** How to redraw an image before adding it, or null to send the file as it is. */
export function reencodePlan(
  filename: string,
  width: number,
  height: number,
): (Size & { type: string }) | null {
  const extension = fileExtension(filename);
  const size = fitWithin(width, height, IMAGE_MAX_EDGE);
  const always = ALWAYS.get(extension);
  if (always) return { type: always, ...size };
  if (extension === 'png' && Math.max(width, height) > IMAGE_MAX_EDGE) {
    return { type: 'image/png', ...size };
  }
  return null;
}

/** JPEG and WebP quality when redrawn: visually the same, much smaller. */
const QUALITY = 0.88;

/**
 * The file to add: redrawn when the plan says so, or the original when it doesn't, when
 * the browser can't decode it, or when it can't encode the type (Safari can't write WebP).
 */
export async function prepareImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const plan = reencodePlan(file.name, bitmap.width, bitmap.height);
    if (!plan) return file;
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, plan.type, QUALITY),
    );
    if (!blob || blob.type !== plan.type) return file;
    return new File([blob], file.name, { type: plan.type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
