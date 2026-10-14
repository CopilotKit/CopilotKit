export const A2UI_FENCE_LANGUAGE = "a2ui";

export type MarkdownSegment =
  | { type: "markdown"; text: string }
  | { type: "a2ui"; index: number; text: string; closed: boolean };

/** Column-0 fence opener: a run of 3+ backticks or tildes, then the info string. */
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;

interface OpenFence {
  /** Fence character (` or ~). */
  char: string;
  /** Length of the opening marker; the closer must be at least this long. */
  length: number;
  /** Offset in the source where the fence body starts. */
  bodyStart: number;
  /** a2ui fence index, or -1 for fences of other languages. */
  index: number;
}

function isCloser(line: string, fence: OpenFence): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fence.length) return false;
  for (const ch of trimmed) {
    if (ch !== fence.char) return false;
  }
  return true;
}

/**
 * Split a (possibly still streaming) markdown string into prose segments and
 * top-level ```a2ui fences. Fences of other languages stay inside prose
 * segments byte-for-byte, and a2ui markers inside them are ignored. Only
 * column-0 fences are recognised, so a fence indented inside a list item is
 * left to the markdown renderer.
 *
 * An a2ui segment's `text` is the fence body. For a closed fence it ends with
 * "\n" when non-empty. For an open (still streaming or aborted) fence it is
 * everything after the opener line, minus a half-streamed closing marker.
 */
export function splitA2UIMarkdown(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let proseStart = 0;
  let fence: OpenFence | null = null;
  let a2uiIndex = 0;

  const pushProse = (end: number) => {
    if (end > proseStart) {
      segments.push({
        type: "markdown",
        text: markdown.slice(proseStart, end),
      });
    }
  };

  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd);

    if (fence) {
      if (isCloser(line, fence)) {
        if (fence.index >= 0) {
          segments.push({
            type: "a2ui",
            index: fence.index,
            text: markdown.slice(
              fence.bodyStart,
              Math.max(fence.bodyStart, lineStart),
            ),
            closed: true,
          });
          proseStart = lineEnd;
        }
        fence = null;
      }
    } else {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        const marker = open[1] ?? "";
        const info = open[2] ?? "";
        const char = marker.charAt(0);
        // Backtick fences cannot have backticks in their info string (CommonMark).
        if (!(char === "`" && info.includes("`"))) {
          const lang = info.trim().split(/\s+/)[0] ?? "";
          const isA2UI = lang === A2UI_FENCE_LANGUAGE;
          if (isA2UI) pushProse(lineStart);
          fence = {
            char,
            length: marker.length,
            bodyStart: newline < 0 ? markdown.length : lineEnd + 1,
            index: isA2UI ? a2uiIndex++ : -1,
          };
        }
      }
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }

  if (fence && fence.index >= 0) {
    let body = markdown.slice(fence.bodyStart);
    // Drop a closing marker that is still streaming in (e.g. "``").
    const lastNewline = body.lastIndexOf("\n");
    const lastLine = body.slice(lastNewline + 1);
    if (
      lastLine.length > 0 &&
      [...lastLine].every((ch) => ch === fence!.char)
    ) {
      body = body.slice(0, lastNewline + 1);
    }
    segments.push({
      type: "a2ui",
      index: fence.index,
      text: body,
      closed: false,
    });
  } else {
    pushProse(markdown.length);
  }

  return segments;
}
