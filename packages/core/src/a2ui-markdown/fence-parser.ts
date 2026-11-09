/** Language of a fenced code block that carries A2UI operations. */
export const A2UI_FENCE_LANGUAGE = "a2ui";

/**
 * One part of an assistant message, in source order: prose markdown, or the
 * body of a top-level ```a2ui fence. `target` is the id from a
 * `target=<id>` token in the fence info string. With no target, the surface
 * goes to the chat.
 */
export type MarkdownSegment =
  | { type: "markdown"; text: string }
  | {
      type: "a2ui";
      index: number;
      text: string;
      closed: boolean;
      target?: string;
    };

type A2UISegment = Extract<MarkdownSegment, { type: "a2ui" }>;

/** Column-0 fence opener: a run of 3+ backticks or tildes, then the info string. */
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;

/** Info-string token that names the placement target of an a2ui fence. */
const TARGET_TOKEN = /^target=(.+)$/;

interface OpenFence {
  /** Fence character (` or ~). */
  char: string;
  /** Length of the opening marker; the closer must be at least this long. */
  length: number;
  /** Offset in the source where the fence body starts. */
  bodyStart: number;
  /** a2ui fence index, or -1 for fences of other languages. */
  index: number;
  /** Target id from the info string of an a2ui fence. */
  target: string | undefined;
}

function isCloser(line: string, fence: OpenFence) {
  const trimmed = line.trim();
  if (trimmed.length < fence.length) return false;
  for (const ch of trimmed) {
    if (ch !== fence.char) return false;
  }
  return true;
}

/** The id of the first `target=<id>` token. Other tokens are ignored. */
function readTarget(tokens: string[]) {
  for (const token of tokens) {
    const match = TARGET_TOKEN.exec(token);
    if (match) return match[1];
  }
  return undefined;
}

function a2uiSegment(fence: OpenFence, text: string, closed: boolean) {
  const segment: A2UISegment = {
    type: "a2ui",
    index: fence.index,
    text,
    closed,
  };
  if (fence.target !== undefined) segment.target = fence.target;
  return segment;
}

/**
 * Split a (possibly still streaming) markdown string into prose segments and
 * top-level ```a2ui fences. Fences of other languages stay inside prose
 * segments byte-for-byte, and a2ui markers inside them are ignored. Only
 * column-0 fences are recognised, so a fence indented inside a list item is
 * left to the markdown renderer.
 *
 * The first info-string token must be exactly `a2ui`. A later
 * `target=<id>` token sets `target` on the segment (for example
 * ```` ```a2ui target=recommendations ````). Other tokens are ignored.
 *
 * An a2ui segment's `text` is the fence body. For a closed fence it ends with
 * "\n" when non-empty. For an open (still streaming or aborted) fence it is
 * everything after the opener line, minus a half-streamed closing marker.
 *
 * @param markdown - The assistant message text, complete or still streaming.
 * @returns The segments in source order.
 *
 * @example
 * ```ts
 * for (const segment of splitA2UIMarkdown(message.content)) {
 *   if (segment.type === "a2ui") renderSurface(segment.text, segment.target);
 *   else renderMarkdown(segment.text);
 * }
 * ```
 */
export function splitA2UIMarkdown(markdown: string) {
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
    // A CRLF line keeps its "\r" in the source slices (prose stays
    // byte-identical) but is matched without it, since "." does not match "\r".
    const hasCR = lineEnd > lineStart && markdown[lineEnd - 1] === "\r";
    const line = markdown.slice(lineStart, hasCR ? lineEnd - 1 : lineEnd);

    if (fence) {
      if (isCloser(line, fence)) {
        if (fence.index >= 0) {
          const body = markdown.slice(
            fence.bodyStart,
            Math.max(fence.bodyStart, lineStart),
          );
          segments.push(a2uiSegment(fence, body, true));
          proseStart = hasCR ? lineEnd - 1 : lineEnd;
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
        const isValidOpener = !(char === "`" && info.includes("`"));
        if (isValidOpener) {
          const [lang = "", ...tokens] = info.trim().split(/\s+/);
          const isA2UI = lang === A2UI_FENCE_LANGUAGE;
          if (isA2UI) pushProse(lineStart);
          fence = {
            char,
            length: marker.length,
            bodyStart: newline < 0 ? markdown.length : lineEnd + 1,
            index: isA2UI ? a2uiIndex++ : -1,
            target: isA2UI ? readTarget(tokens) : undefined,
          };
        }
      }
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }

  if (fence && fence.index >= 0) {
    const { char } = fence;
    let body = markdown.slice(fence.bodyStart);
    // Drop a closing marker that is still streaming in (e.g. "``").
    const lastNewline = body.lastIndexOf("\n");
    const lastLine = body.slice(lastNewline + 1).replace(/\r$/, "");
    const isHalfCloser =
      lastLine.length > 0 && [...lastLine].every((ch) => ch === char);
    if (isHalfCloser) {
      body = body.slice(0, lastNewline + 1);
    }
    segments.push(a2uiSegment(fence, body, false));
  } else {
    pushProse(markdown.length);
  }

  return segments;
}
