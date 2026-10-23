// Drag Wheel: the ring of one-step actions that appears when a PDF is
// dragged onto the ILMPDF home page. This file holds only the lists and the
// geometry (plain maths, no browser), so it can be unit-tested directly.
//
// Angles are in radians, measured clockwise from the positive x axis
// (screen coordinates: y grows downwards). Slice 0 is centred at the top.

export type QuickId = 'compress' | 'png' | 'jpg' | 'text' | 'ocr' | 'clean' | 'flatten';

export type Slice = {
  id: QuickId;
  /** Short label printed on the slice. */
  label: string;
  /** What the slice does, shown under the wheel while hovering it. */
  hint: string;
  /** Icon outline: an SVG path on a 24 x 24 grid, drawn as a stroke. */
  icon: string;
};

export const QUICK_SLICES: Slice[] = [
  { id: 'compress', label: 'COMPRESS', hint: 'Save a smaller copy (recommended quality)', icon: 'M4 4l6 6M10 5v5H5M20 20l-6-6M14 19v-5h5' },
  { id: 'png', label: 'PNG', hint: 'Save every page as a PNG image', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01' },
  { id: 'jpg', label: 'JPG', hint: 'Save every page as a JPG image', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01' },
  { id: 'text', label: 'TEXT', hint: 'Save the text as a .txt file', icon: 'M5 6h14M5 10h14M5 14h10M5 18h7' },
  { id: 'ocr', label: 'OCR', hint: 'Make scanned pages searchable', icon: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8' },
  { id: 'clean', label: 'CLEAN', hint: 'Remove hidden details, scripts and attached files', icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z' },
  { id: 'flatten', label: 'FLATTEN', hint: 'Bake form fields and comments into the pages', icon: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4' },
];

/** Where slice 0 starts, and the angle each slice covers. */
export function layout(count: number): { start: number; step: number } {
  const step = (2 * Math.PI) / count;
  return { start: -Math.PI / 2 - step / 2, step };
}

/** A slice index, the centre ("hub"), or nothing (outside the wheel). */
export type Hit = number | 'hub' | null;

/** Extra reach past the outer edge, so a drop just outside a slice still counts. */
export const EDGE_SLACK = 16;

/**
 * Which part of the wheel a point is over. (dx, dy) is the point relative to
 * the wheel's centre; `outer` and `inner` are the ring's radii.
 */
export function hitTest(dx: number, dy: number, count: number, outer: number, inner: number): Hit {
  const distance = Math.hypot(dx, dy);
  if (distance < inner) return 'hub';
  if (distance > outer + EDGE_SLACK || count < 1) return null;
  const { start, step } = layout(count);
  const turn = 2 * Math.PI;
  const angle = (((Math.atan2(dy, dx) - start) % turn) + turn) % turn;
  return Math.min(count - 1, Math.floor(angle / step));
}

const fmt = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 100) / 100);
const point = (angle: number, radius: number) => `${fmt(Math.cos(angle) * radius)},${fmt(Math.sin(angle) * radius)}`;

/**
 * The SVG path of one ring slice, centred on (0, 0). `gap` is the width of
 * the empty strip between neighbouring slices, in pixels.
 */
export function slicePath(index: number, count: number, outer: number, inner: number, gap = 6): string {
  const { start, step } = layout(count);
  const a0 = start + index * step;
  const a1 = a0 + step;
  // Turning a fixed gap width into an angle needs the radius, so the inner
  // edge gets a larger angular trim than the outer one.
  const go = gap / 2 / outer;
  const gi = gap / 2 / inner;
  const large = step > Math.PI ? 1 : 0;
  return (
    `M${point(a0 + go, outer)} A${outer},${outer} 0 ${large} 1 ${point(a1 - go, outer)}` +
    ` L${point(a1 - gi, inner)} A${inner},${inner} 0 ${large} 0 ${point(a0 + gi, inner)} Z`
  );
}

/** The middle of a slice at the given radius, for its icon and label. */
export function sliceCentre(index: number, count: number, radius: number): { x: number; y: number; angle: number } {
  const { start, step } = layout(count);
  const angle = start + (index + 0.5) * step;
  return { x: fmt(Math.cos(angle) * radius), y: fmt(Math.sin(angle) * radius), angle };
}

/** Keeps a wheel of the given radius fully inside a width x height area. */
export function clampCentre(x: number, y: number, width: number, height: number, radius: number, margin = 12): { x: number; y: number } {
  const keep = (v: number, size: number) => {
    const lo = radius + margin;
    const hi = size - radius - margin;
    return lo > hi ? size / 2 : Math.min(Math.max(v, lo), hi);
  };
  return { x: keep(x, width), y: keep(y, height) };
}

/** Wheel radii for a viewport, so it still fits on a small window. */
export function wheelSize(width: number, height: number): { outer: number; inner: number } {
  const outer = Math.round(Math.max(110, Math.min(160, Math.min(width, height) / 2 - 40)));
  return { outer, inner: Math.round(outer * 0.38) };
}
