/**
 * Streaming-polish layer for Teams' post-then-edit streaming.
 *
 * While an agent is mid-stream the buffer is usually an *unfinished* markdown
 * document: an open code fence, an unclosed `**`, etc. Teams renders message
 * text as markdown, so editing the message with unbalanced text makes the rest
 * of the bubble render broken (a stray ``` turns the remainder into a code
 * block until the closer arrives, a dangling `**` bolds the rest, and so on).
 *
 * `autoCloseOpenMarkdown` returns a balanced copy of the buffer by appending the
 * minimum set of closers needed for well-formed display. When the agent later
 * emits the real closer the buffer balances on its own and this adds nothing,
 * so the *committed* (finalized) message has no synthetic closers.
 *
 * Handled, in priority order:
 *   1. Unclosed fenced code blocks ``` (most severe: leaks code styling)
 *   2. Unclosed inline code
 *   3. Unclosed bold `**` / `__`, italic `*` / `_`, strike `~~`
 *
 * Heuristics:
 *   - A marker with no content after it (trailing `**`) is NOT closed. The
 *     agent may just be opening it; closing would flash a transient `****`.
 *   - Markers inside code/fence regions don't count.
 *   - Closers are emitted innermost-first so the structure nests correctly.
 */

// Private-use codepoints that will never appear in agent markdown, used to
// stash already-balanced regions while we scan for the dangling opener.
const SENTINEL_FENCE = "\uE000";
const SENTINEL_INLINE = "\uE001";

export function autoCloseOpenMarkdown(text: string): string {
  if (!text) return text;

  // ── 1. Fenced code blocks ──────────────────────────────────────────
  const fences: string[] = [];
  let work = text.replace(/```[\s\S]*?```/g, (m) => {
    fences.push(m);
    return `${SENTINEL_FENCE}${fences.length - 1}${SENTINEL_FENCE}`;
  });

  const openFenceIdx = work.indexOf("```");
  let openFenceTail = "";
  if (openFenceIdx >= 0) {
    openFenceTail = work.slice(openFenceIdx);
    work = work.slice(0, openFenceIdx);
  }

  // ── 2. Inline code regions ─────────────────────────────────────────
  const inlines: string[] = [];
  work = work.replace(/`[^`\n]+`/g, (m) => {
    inlines.push(m);
    return `${SENTINEL_INLINE}${inlines.length - 1}${SENTINEL_INLINE}`;
  });

  const openBacktickIdx = work.indexOf("`");
  let openBacktickTail = "";
  if (openBacktickIdx >= 0) {
    openBacktickTail = work.slice(openBacktickIdx);
    work = work.slice(0, openBacktickIdx);
  }

  // ── 3. Bold / italic / strike via stack scan ──────────────────────
  const stack = scanBracketStack(work);
  const closers = stack.slice().toReversed().join("");

  // ── 4. Reassemble ─────────────────────────────────────────────────
  // Insert closers BEFORE trailing whitespace so "**bold " → "**bold**".
  let output = work;
  if (closers) {
    const trail = output.match(/\s*$/)?.[0] ?? "";
    output = output.slice(0, output.length - trail.length) + closers + trail;
  }

  if (openBacktickTail) {
    output += openBacktickTail;
    if (hasContentAfterMarker(openBacktickTail, "`")) output += "`";
  }

  output = output.replace(
    new RegExp(`${SENTINEL_INLINE}(\\d+)${SENTINEL_INLINE}`, "g"),
    (_, idx) => inlines[Number(idx)] ?? "",
  );

  if (openFenceTail) {
    output += openFenceTail;
    if (hasFenceCodeContent(openFenceTail)) {
      output += openFenceTail.endsWith("\n") ? "```" : "\n```";
    }
  }

  output = output.replace(
    new RegExp(`${SENTINEL_FENCE}(\\d+)${SENTINEL_FENCE}`, "g"),
    (_, idx) => fences[Number(idx)] ?? "",
  );

  return output;
}

/**
 * Walk `text` and return the unbalanced bracket stack. Recognises (longest
 * first) `**`, `__`, `~~`, then `*`, `_`, so `**` is one bold marker, not two
 * italics. A trailing marker with no content after it is dropped (closing it
 * would flash a transient `****`).
 */
function scanBracketStack(text: string): string[] {
  const stack: string[] = [];
  const tryToggle = (m: string) => {
    if (stack[stack.length - 1] === m) stack.pop();
    else stack.push(m);
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      tryToggle("**");
      i += 2;
    } else if (text.startsWith("__", i)) {
      tryToggle("__");
      i += 2;
    } else if (text.startsWith("~~", i)) {
      tryToggle("~~");
      i += 2;
    } else if (text[i] === "*") {
      tryToggle("*");
      i += 1;
    } else if (text[i] === "_") {
      tryToggle("_");
      i += 1;
    } else {
      i += 1;
    }
  }

  while (stack.length > 0) {
    const last = stack[stack.length - 1]!;
    const lastIdx = text.lastIndexOf(last);
    if (lastIdx < 0) break;
    const after = text.slice(lastIdx + last.length);
    if (/^\s*$/.test(after)) stack.pop();
    else break;
  }

  return stack;
}

function hasContentAfterMarker(tail: string, marker: string): boolean {
  if (!tail.startsWith(marker)) return false;
  return /\S/.test(tail.slice(marker.length));
}

/**
 * True if a ```` ```<lang>?\n<content> ```` buffer has actual code past the
 * optional language line (the first newline separates the language tag from the
 * code body). A buffer still on the language line has nothing to close yet.
 */
function hasFenceCodeContent(tail: string): boolean {
  if (!tail.startsWith("```")) return false;
  const after = tail.slice(3);
  const nl = after.indexOf("\n");
  if (nl < 0) return false;
  return /\S/.test(after.slice(nl + 1));
}
