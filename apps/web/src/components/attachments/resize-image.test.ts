import { describe, expect, it } from 'vitest';
import { fitWithin, reencodePlan } from './resize-image';

describe('fitWithin', () => {
  it('shrinks the long edge to the limit, keeping the shape', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it('leaves an image already within the limit alone', () => {
    expect(fitWithin(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
  });

  it('never rounds an edge down to nothing', () => {
    expect(fitWithin(10000, 1, 2048)).toEqual({ width: 2048, height: 1 });
  });
});

describe('reencodePlan', () => {
  it('always re-encodes JPEG and WebP, which bakes in the photo’s rotation', () => {
    expect(reencodePlan('photo.jpg', 800, 600)).toEqual({
      type: 'image/jpeg',
      width: 800,
      height: 600,
    });
    expect(reencodePlan('sticker.WEBP', 4000, 2000)).toEqual({
      type: 'image/webp',
      width: 2048,
      height: 1024,
    });
  });

  it('re-encodes a PNG only when it’s too big', () => {
    expect(reencodePlan('chart.png', 800, 600)).toBeNull();
    expect(reencodePlan('chart.png', 4096, 1024)).toEqual({
      type: 'image/png',
      width: 2048,
      height: 512,
    });
  });

  it('leaves GIFs, which may be animated, and files that aren’t images alone', () => {
    expect(reencodePlan('wave.gif', 4000, 4000)).toBeNull();
    expect(reencodePlan('rota.pdf', 0, 0)).toBeNull();
  });
});
