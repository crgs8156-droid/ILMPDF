// Visual comparison of two rendered pages. Pure code on pixel arrays, so it
// can be unit-tested without a browser. The pages were already drawn by
// PDF.js; nothing here reads a PDF.

/** The same shape as the browser's ImageData: RGBA bytes, row by row. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/**
 * How far apart two pixels must be (sum of the red, green and blue
 * differences, 0 to 765) to count as changed. Small differences come from
 * anti-aliasing at the edges of letters and are ignored.
 */
export const PIXEL_THRESHOLD = 60;

export type PixelDiff = {
  /** Faded copy of the newer page with every changed pixel painted red. */
  image: Pixels;
  changed: number;
  /** Share of the page that changed, from 0 to 1. */
  ratio: number;
};

/**
 * Compares two renders pixel by pixel. If the pages differ in size, the
 * result covers both, and the area only one page has counts as changed.
 */
export function diffPixels(a: Pixels, b: Pixels, threshold = PIXEL_THRESHOLD): PixelDiff {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  // Transparent pixels (outside a page) read as white paper.
  const read = (p: Pixels, x: number, y: number, c: number) => {
    if (x >= p.width || y >= p.height) return -1;
    const i = (y * p.width + x) * 4;
    const alpha = p.data[i + 3]! / 255;
    return Math.round(p.data[i + c]! * alpha + 255 * (1 - alpha));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let distance = 0;
      let outside = false;
      let grey = 0;
      for (let c = 0; c < 3; c++) {
        const va = read(a, x, y, c);
        const vb = read(b, x, y, c);
        if (va < 0 || vb < 0) outside = true;
        else distance += Math.abs(va - vb);
        grey += vb < 0 ? va : vb;
      }
      if (outside || distance > threshold) {
        changed++;
        out[o] = 230;
        out[o + 1] = 30;
        out[o + 2] = 30;
      } else {
        // Unchanged: a light grey version of the page, so red stands out.
        const light = 255 - Math.round((255 - grey / 3) * 0.3);
        out[o] = out[o + 1] = out[o + 2] = light;
      }
      out[o + 3] = 255;
    }
  }
  return { image: { width, height, data: out }, changed, ratio: width * height ? changed / (width * height) : 0 };
}
