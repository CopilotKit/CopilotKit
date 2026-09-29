import { h } from "vue";
import type { VNodeChild } from "vue";

/*
 * Lightweight markdown preview for the chat composer: list markers and links.
 * The composer stays a native <textarea> (caret, selection, IME and undo all
 * keep working); its text is transparent and this layer, drawn underneath with
 * identical metrics, shows the same characters with styling. Every character
 * is kept, so the layers stay aligned — styling may change color or underline,
 * but never glyph widths.
 */

const FENCE = /^\s*(```|~~~)/;
const LIST_MARKER = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/;
// A [text](url) link, or a bare URL.
const LINK =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function highlightLinks(text: string): VNodeChild[] {
  const nodes: VNodeChild[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [, label, url, bare] = match;
    nodes.push(
      label
        ? h("span", [
            h("span", { class: "cpk-md-syntax" }, "["),
            h("span", { class: "cpk-md-link" }, label),
            h("span", { class: "cpk-md-syntax" }, `](${url})`),
          ])
        : h("span", { class: "cpk-md-link" }, bare),
    );
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Renders composer text with list markers and links styled, character for
 * character. Pair with a transparent textarea of identical typography and
 * padding.
 */
export function highlightMarkdownInput(text: string): VNodeChild[] {
  const lines = text.split("\n");
  let inFence = false;

  const nodes: VNodeChild[] = lines.map((line, index) => {
    const newline = index < lines.length - 1 ? "\n" : "";

    // Fenced code is left as typed.
    const isFence = FENCE.test(line);
    if (isFence) inFence = !inFence;
    if (isFence || inFence) return line + newline;

    const list = LIST_MARKER.exec(line);
    return h("span", [
      ...(list
        ? [
            list[1],
            h("span", { class: "cpk-md-list-marker" }, list[2]),
            list[3],
          ]
        : []),
      ...highlightLinks(list ? line.slice(list[0].length) : line),
      newline,
    ]);
  });

  // A trailing newline has no content to give the last line height.
  if (text.endsWith("\n")) nodes.push("​");
  return nodes;
}
