/*
 * The streaming cursor rides at the end of a reply's text while it's written.
 * Markdown renders natively here (a single text view per message), so the
 * cursor is a dot appended to the source, landing at the end of the last block
 * with text — a paragraph, list item, heading or quote — like the web's cursor
 * anchor. A non-breaking space keeps it on the line with the last word.
 */
export const STREAMING_CURSOR = "\u00a0●";

const FENCE = /^ {0,3}(```|~~~)/;

/**
 * `markdown` with the cursor at the end of its text, or `undefined` when the
 * last block has no text to follow (a code block, open or closed) and the
 * cursor belongs just below it instead.
 */
export function appendStreamingCursor(markdown: string): string | undefined {
  const text = markdown.trimEnd();
  if (!text || endsInCodeBlock(text)) return undefined;
  return text + STREAMING_CURSOR;
}

function endsInCodeBlock(text: string): boolean {
  let inFence = false;
  let lastLineIsFence = false;
  for (const line of text.split("\n")) {
    lastLineIsFence = FENCE.test(line);
    if (lastLineIsFence) inFence = !inFence;
  }
  return inFence || lastLineIsFence;
}
