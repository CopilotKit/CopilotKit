import type { Ref } from "react";

/**
 * The "decompile" transition between a rendered view and its A2UI: the layer
 * on top breaks into a coarsening mosaic, the A2UI plate crossfades, and the
 * layer underneath resolves from a mosaic back to sharp.
 *
 * The mosaic is an SVG filter applied to each layer with CSS `filter: url()`.
 * Its block size changes every frame, which needs the filter's attributes
 * set directly; React state would re-render the whole view sixty times a
 * second.
 */

/** How long one decompile (or compile back) takes. */
export const DECOMPILE_MS = 1100;
/** The coarsest mosaic, as a dilate radius: blocks of 2r + 1 pixels. */
const PIXEL_MAX = 12;

/**
 * An SVG filter that pixelates what it is applied to. It softens the layer
 * so each block carries its area's average color, keeps one pixel at the
 * center of every block, and dilates each kept pixel to fill its block. The
 * numbers here are placeholders: `setBlockRadius` sets them per frame.
 */
export function PixelateFilter({
  id,
  ref,
}: {
  id: string;
  ref: Ref<SVGFilterElement>;
}) {
  return (
    <filter ref={ref} id={id} x="0" y="0" width="1" height="1">
      <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="soft" />
      <feFlood x="1" y="1" width="1" height="1" />
      <feComposite width="3" height="3" />
      <feTile result="tiles" />
      <feComposite in="soft" in2="tiles" operator="in" />
      <feMorphology operator="dilate" radius="1" />
    </filter>
  );
}

/** Pixelates `layer` with `filter` at `radius`; 0 takes the filter off. */
function setBlockRadius(
  layer: HTMLElement,
  filter: SVGFilterElement,
  radius: number,
) {
  if (radius <= 0) {
    layer.style.filter = "";
    return;
  }
  const [soften, sample, block, , , dilate] = Array.from(filter.children);
  const size = String(radius * 2 + 1);
  soften.setAttribute("stdDeviation", String(radius / 2));
  sample.setAttribute("x", String(radius));
  sample.setAttribute("y", String(radius));
  block.setAttribute("width", size);
  block.setAttribute("height", size);
  dilate.setAttribute("radius", String(radius));
  layer.style.filter = `url(#${filter.id})`;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Where `t` is within [from, to], as 0-1. */
const progress = (t: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (t - from) / (to - from)));

export interface DecompileLayers {
  view: HTMLElement;
  viewFilter: SVGFilterElement;
  plate: HTMLElement;
  plateFilter: SVGFilterElement;
}

/**
 * Runs one decompile ("toSource") or compile back, and calls `onDone` at
 * the end. Returns a function that stops it and clears every style it set.
 */
export function runDecompile(
  { view, viewFilter, plate, plateFilter }: DecompileLayers,
  toSource: boolean,
  onDone: () => void,
) {
  const [breaking, breakingFilter] = toSource
    ? [view, viewFilter]
    : [plate, plateFilter];
  const [forming, formingFilter] = toSource
    ? [plate, plateFilter]
    : [view, viewFilter];
  const start = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / DECOMPILE_MS);
    // First half: the top layer breaks up. Second half: the other resolves.
    setBlockRadius(
      breaking,
      breakingFilter,
      Math.round(easeOut(progress(t, 0, 0.5)) * PIXEL_MAX),
    );
    setBlockRadius(
      forming,
      formingFilter,
      Math.round((1 - easeOut(progress(t, 0.42, 1))) * PIXEL_MAX),
    );
    // In between, the plate fades in (or out) over the view.
    const fade = progress(t, 0.34, 0.56);
    plate.style.opacity = String(toSource ? fade : 1 - fade);
    if (t < 1) frame = requestAnimationFrame(tick);
    else onDone();
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    view.style.filter = "";
    plate.style.filter = "";
    plate.style.opacity = "";
  };
}
