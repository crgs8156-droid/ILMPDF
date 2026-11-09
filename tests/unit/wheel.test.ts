import { describe, expect, it } from 'vitest';
import {
  EDGE_SLACK,
  IMAGE_SLICES,
  MANY_SLICES,
  QUICK_SLICES,
  RINGS,
  SAME_FOR_MANY,
  clampCentre,
  hitTest,
  layout,
  pickRing,
  ringForFiles,
  sliceCentre,
  slicePath,
  wheelSize,
} from '../../src/core/wheel';

const OUTER = 150;
const INNER = 57;

describe('wheel hit testing', () => {
  it('finds the centre, each slice, and the outside', () => {
    expect(hitTest(0, 0, 7, OUTER, INNER)).toBe('hub');
    expect(hitTest(INNER - 1, 0, 7, OUTER, INNER)).toBe('hub');
    expect(hitTest(0, -100, 7, OUTER, INNER)).toBe(0); // straight up is slice 0
    expect(hitTest(0, -(OUTER + EDGE_SLACK - 1), 7, OUTER, INNER)).toBe(0);
    expect(hitTest(0, -(OUTER + EDGE_SLACK + 1), 7, OUTER, INNER)).toBeNull();
  });

  it('goes clockwise from the top, and every slice centre hits its own slice', () => {
    for (const n of [3, 6, 7, 8]) {
      for (let i = 0; i < n; i++) {
        const c = sliceCentre(i, n, (OUTER + INNER) / 2);
        expect(hitTest(c.x, c.y, n, OUTER, INNER)).toBe(i);
      }
    }
    // Right of centre is clockwise from the top, so it is a later slice than the left side's mirror.
    expect(hitTest(100, -10, 8, OUTER, INNER)).toBe(2);
    expect(hitTest(-100, -10, 8, OUTER, INNER)).toBe(6);
  });

  it('handles the seam where the angle wraps round', () => {
    const { start } = layout(7);
    const just = (a: number) => [Math.cos(a) * 100, Math.sin(a) * 100] as const;
    expect(hitTest(...just(start + 0.001), 7, OUTER, INNER)).toBe(0);
    expect(hitTest(...just(start - 0.001), 7, OUTER, INNER)).toBe(6);
  });
});

describe('wheel drawing', () => {
  it('draws a closed ring sector with plain numbers', () => {
    const d = slicePath(0, 7, OUTER, INNER);
    expect(d).toMatch(/^M-?[\d.]+,-?[\d.]+ A150,150 0 0 1 -?[\d.]+,-?[\d.]+ L-?[\d.]+,-?[\d.]+ A57,57 0 0 0 -?[\d.]+,-?[\d.]+ Z$/);
    expect(d).not.toMatch(/NaN|e-/);
  });

  it('keeps the wheel inside the window', () => {
    expect(clampCentre(5, 5, 1000, 800, 160)).toEqual({ x: 172, y: 172 });
    expect(clampCentre(995, 795, 1000, 800, 160)).toEqual({ x: 828, y: 628 });
    expect(clampCentre(500, 400, 1000, 800, 160)).toEqual({ x: 500, y: 400 });
    // A window smaller than the wheel centres it instead.
    expect(clampCentre(10, 10, 200, 200, 160)).toEqual({ x: 100, y: 100 });
  });

  it('sizes the wheel to the window', () => {
    expect(wheelSize(1400, 900).outer).toBe(160);
    expect(wheelSize(360, 700).outer).toBe(140); // the narrow side sets the size: 360 / 2 - 40
    expect(wheelSize(300, 300).outer).toBe(110);
    const { outer, inner } = wheelSize(1000, 1000);
    expect(inner).toBe(Math.round(outer * 0.38));
  });

  it('has the quick actions in a fixed order with unique ids', () => {
    expect(QUICK_SLICES.map((s) => s.id)).toEqual(['compress', 'png', 'jpg', 'text', 'ocr', 'clean', 'flatten']);
    expect(MANY_SLICES.map((s) => s.id)).toEqual(['merge', 'compressAll', 'textAll', 'pngAll', 'cleanAll', 'ocrAll']);
    expect(IMAGE_SLICES.map((s) => s.id)).toEqual(['imgPdf', 'imgFit', 'imgOcr']);
    const all = Object.values(RINGS).flat();
    // Ids double as test ids and busy texts, so they must be unique across rings.
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) expect(s.icon).toMatch(/^M[\d .,MLHVAZhvlmaz-]+$/);
  });
});

describe('choosing a ring', () => {
  const file = (type: string) => ({ kind: 'file', type });

  it('picks the ring from what is being dragged', () => {
    expect(pickRing([file('application/pdf')])).toBe('one');
    expect(pickRing([file('application/pdf'), file('application/pdf')])).toBe('many');
    expect(pickRing([file('image/png')])).toBe('images');
    expect(pickRing([file('image/png'), file('image/jpeg')])).toBe('images');
    // A mix shows the several-PDFs ring; the drop then explains the mix.
    expect(pickRing([file('image/png'), file('application/pdf')])).toBe('many');
    // Hidden types are treated as PDFs, and text being dragged is ignored.
    expect(pickRing([file(''), file('')])).toBe('many');
    expect(pickRing([{ kind: 'string', type: 'text/plain' }, file('')])).toBe('one');
    expect(pickRing([])).toBe('one');
  });

  it('checks the dropped files by type or name', () => {
    expect(ringForFiles([{ name: 'a.pdf', type: 'application/pdf' }])).toBe('one');
    expect(ringForFiles([{ name: 'a.pdf', type: '' }, { name: 'b.PDF', type: '' }])).toBe('many');
    expect(ringForFiles([{ name: 'photo.HEIC', type: '' }])).toBe('images');
    expect(ringForFiles([{ name: 'scan', type: 'image/jpeg' }, { name: 'b.png', type: '' }])).toBe('images');
    expect(ringForFiles([{ name: 'a.pdf', type: '' }, { name: 'b.jpg', type: '' }])).toBeNull();
    // Anything else goes to the PDF rings, where loading explains what is wrong.
    expect(ringForFiles([{ name: 'notes.txt', type: 'text/plain' }])).toBe('one');
  });

  it('maps one-PDF slices to their several-PDFs twins', () => {
    const many = new Set(MANY_SLICES.map((s) => s.id));
    for (const twin of Object.values(SAME_FOR_MANY)) expect(many.has(twin!)).toBe(true);
    expect(SAME_FOR_MANY.flatten).toBeUndefined();
    expect(SAME_FOR_MANY.jpg).toBeUndefined();
  });
});
