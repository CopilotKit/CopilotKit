import React from "react";

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

function highlightLinks(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [, label, url, bare] = match;
    const key = `${keyPrefix}-${start}`;
    nodes.push(
      label ? (
        <span key={key}>
          <span className="cpk-md-syntax">[</span>
          <span className="cpk-md-link">{label}</span>
          <span className="cpk-md-syntax">]({url})</span>
        </span>
      ) : (
        <span key={key} className="cpk-md-link">
          {bare}
        </span>
      ),
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
export function highlightMarkdownInput(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  let inFence = false;

  const nodes: React.ReactNode[] = lines.map((line, index) => {
    const key = `l${index}`;
    const newline = index < lines.length - 1 ? "\n" : "";

    // Fenced code is left as typed.
    const isFence = FENCE.test(line);
    if (isFence) inFence = !inFence;
    if (isFence || inFence) {
      return (
        <React.Fragment key={key}>
          {line}
          {newline}
        </React.Fragment>
      );
    }

    const list = LIST_MARKER.exec(line);
    return (
      <span key={key}>
        {list && (
          <>
            {list[1]}
            <span className="cpk-md-list-marker">{list[2]}</span>
            {list[3]}
          </>
        )}
        {highlightLinks(list ? line.slice(list[0].length) : line, key)}
        {newline}
      </span>
    );
  });

  // A trailing newline has no content to give the last line height.
  if (text.endsWith("\n")) nodes.push("​");
  return nodes;
}
