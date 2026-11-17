/**
 * What a model does not need to read about the standard components. Models
 * lay out with gap, align and justify and let the theme do the rest, so the
 * styling knobs stay out of every prompt (the browser still accepts them),
 * and the standard components' longer usage notes, written for a chat that
 * also writes markdown, are cut to their first sentence.
 */
export const STYLE_PROPS = new Set([
  "background",
  "border",
  "borderColor",
  "radius",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "flex",
  "weight",
  "aspectRatio",
  "scrollable",
  "clip",
  "shadow",
  "shadowStyle",
  "inline",
  "role",
  "flush",
  "minSize",
  "maxSize",
  "disableAutoSpacing",
  "rowGap",
  "columnGap",
  "checks",
  "name",
  "fontSize",
  "lineHeight",
  "minLines",
  "maxLines",
  "truncate",
  "preserveWhitespace",
  "italic",
  "underline",
  "lineThrough",
  "highlight",
  "position",
  "hoverZoom",
  "frame",
  "fit",
  "fallback",
  "hideOnFailure",
  "uniform",
  "pill",
  "autoSelect",
  "mask",
  "padding",
]);

export const firstSentence = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
