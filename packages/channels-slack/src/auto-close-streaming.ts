/**
 * Streaming-polish layer: while an agent is mid-stream, the buffer is
 * usually an *unfinished* markdown document — an open code fence, an
 * unclosed `**`, etc. If we send the unbalanced text straight to Slack,
 * the rest of the message renders broken (a stray ``` will turn the rest
 * of the Slack message into a code block until the closer arrives).
 *
 * `autoCloseOpenMarkdown` returns a balanced copy of the buffer by
 * appending the minimum set of closers needed so that the markdown is
 * well-formed for display. When the agent later emits the real closer,
 * the buffer becomes balanced on its own and this function adds nothing
 * — i.e. no double-close in the committed Slack message.
 *
 * Operates in **markdown space** (i.e. on the raw text from the agent,
 * before mrkdwn translation). The caller composes this with
 * `markdownToMrkdwn` afterwards so the translator sees a balanced
 * document.
 *
 * What it handles, in priority order:
 *
 *   1. Unclosed fenced code blocks ``` … (most severe — leaks code styling
 *      through the rest of the Slack message)
 *   2. Unclosed inline code `…`
 *   3. Unclosed bold `**…` / `__…`
 *   4. Unclosed italic `*…` / `_…`
 *   5. Unclosed strike `~~…`
 *
 * Heuristics:
 *
 *   - A marker with no content after it (e.g. trailing `**`) is **not**
 *     closed — the agent might be just opening the bracket; closing would
 *     produce a transient `****` which looks worse than `**`.
 *   - Markers inside code/fence regions don't count.
 *   - When closing, we emit closers in reverse stack order (innermost
 *     first) so the rendered structure is well-nested.
 */

const SENTINEL_FENCE = "";
const SENTINEL_INLINE = "";

export function autoCloseOpenMarkdown(text: string): string {
  if (!text) return text;

  // ── 1. Fenced code blocks ──────────────────────────────────────────
  // Pair complete fences first, then determine if there's a dangling open.
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

  // Dangling open inline backtick? Only count if there's content after it.
  const openBacktickIdx = work.indexOf("`");
  let openBacktickTail = "";
  if (openBacktickIdx >= 0) {
    openBacktickTail = work.slice(openBacktickIdx);
    work = work.slice(0, openBacktickIdx);
  }

  // ── 3. Bold / italic / strike via stack scan ──────────────────────
  const stack: string[] = scanBracketStack(work);
  // Closers in pop order (innermost first) so the rendered structure
  // nests correctly: e.g. `**bold _italic` → close `_` then `**`.
  const closers = stack.slice().reverse().join("");

  // ── 4. Reassemble ─────────────────────────────────────────────────
  // Insert closers BEFORE any trailing whitespace on the work text so a
  // buffer like "**bold " produces "**bold**" rather than "**bold **".
  let output = work;
  if (closers) {
    const trail = output.match(/\s*$/)?.[0] ?? "";
    output = output.slice(0, output.length - trail.length) + closers + trail;
  }

  // Inline backtick: if dangling open has content after it, close it.
  if (openBacktickTail) {
    output += openBacktickTail;
    if (hasContentAfterMarker(openBacktickTail, "`")) {
      output += "`";
    }
  }

  // Restore inline regions (paired backticks that were untouched).
  output = output.replace(
    new RegExp(`${SENTINEL_INLINE}(\\d+)${SENTINEL_INLINE}`, "g"),
    (_, idx) => inlines[Number(idx)] ?? "",
  );

  // Fenced code: if there's real code content (text after the optional
  // language line), close the fence. A buffer like "```py" or "```py\n"
  // is "just opened" and should NOT yet be closed.
  if (openFenceTail) {
    output += openFenceTail;
    if (hasFenceCodeContent(openFenceTail)) {
      output += openFenceTail.endsWith("\n") ? "```" : "\n```";
    }
  }

  // Restore paired fences.
  output = output.replace(
    new RegExp(`${SENTINEL_FENCE}(\\d+)${SENTINEL_FENCE}`, "g"),
    (_, idx) => fences[Number(idx)] ?? "",
  );

  return output;
}

/**
 * Walks `text` left-to-right and returns the unbalanced bracket stack.
 * Recognised markers (longer ones first): `**`, `__`, `~~`, then `*`, `_`.
 *
 * Standalone single-char markers don't match when they're part of the
 * doubled variant — `**` is parsed as one bold marker, not two italics.
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

  // Strip any marker at the top of the stack that has NO content after it
  // (i.e. it appears at the very end of the buffer with only whitespace
  // following). Closing those would produce a transient `****`-style
  // artefact that looks worse than the open `**`.
  while (stack.length > 0) {
    const last = stack[stack.length - 1]!;
    const lastIdx = text.lastIndexOf(last);
    if (lastIdx < 0) break;
    const after = text.slice(lastIdx + last.length);
    if (/^\s*$/.test(after)) {
      stack.pop();
    } else {
      break;
    }
  }

  return stack;
}

function hasContentAfterMarker(tail: string, marker: string): boolean {
  if (!tail.startsWith(marker)) return false;
  const after = tail.slice(marker.length);
  return /\S/.test(after);
}

/**
 * True if a `\`\`\`<lang>?\n<content>` buffer has actual code content
 * past the optional language line. We treat the first newline as the
 * boundary between the (optional) language tag and code body.
 */
function hasFenceCodeContent(tail: string): boolean {
  if (!tail.startsWith("```")) return false;
  const after = tail.slice(3);
  const nl = after.indexOf("\n");
  if (nl < 0) {
    // No newline yet — still on the language line. Nothing to close.
    return false;
  }
  const code = after.slice(nl + 1);
  return /\S/.test(code);
}

/**
 * What markdown context is *still open* at the end of `text`? Used to
 * decide what opening marker(s) the NEXT chunk needs prepended when we
 * split a long buffer across multiple Slack messages mid-formatting
 * — without this, a chunk boundary inside a ` ```python … ``` ` block
 * would have the second Slack message start with raw code that Slack
 * renders as plain text.
 */
export interface OpenMarkdownContext {
  /** If inside an unclosed fence, the language tag (may be ""). null otherwise. */
  fenceLang: string | null;
  /** True if an unclosed single-backtick inline-code span is in flight. */
  inlineCode: boolean;
  /** Bold/italic/strike markers still open, in stack order (outermost first). */
  brackets: string[];
}

export function detectOpenContext(text: string): OpenMarkdownContext {
  if (!text) return { fenceLang: null, inlineCode: false, brackets: [] };

  // ── Fence ────────────────────────────────────────────────────────
  // Pair complete fences off the text; what remains tells us if a fence
  // is still open and (if so) what its language tag is.
  const paired = text.replace(/```[\s\S]*?```/g, "");
  const openFenceIdx = paired.indexOf("```");
  let fenceLang: string | null = null;
  let remainder = paired;
  if (openFenceIdx >= 0) {
    // Everything from openFenceIdx onward is inside the open fence.
    const tail = paired.slice(openFenceIdx);
    const firstLine = tail.slice(3).split("\n", 1)[0] ?? "";
    fenceLang = firstLine.trim();
    remainder = paired.slice(0, openFenceIdx);
  }

  // ── Inline code (outside fences) ─────────────────────────────────
  // Strip paired inline backticks; an odd remaining ` means open.
  remainder = remainder.replace(/`[^`\n]+`/g, "");
  const inlineCode = (remainder.match(/`/g) || []).length % 2 === 1;
  // Cut at the last lone backtick — inside-inline content shouldn't
  // contribute to bracket counting.
  if (inlineCode) {
    const lastBt = remainder.lastIndexOf("`");
    if (lastBt >= 0) remainder = remainder.slice(0, lastBt);
  }

  // ── Brackets (bold/italic/strike) ────────────────────────────────
  const brackets = scanBracketStackForContext(remainder);

  return { fenceLang, inlineCode, brackets };
}

/** Like scanBracketStack but exposed for context detection (no whitespace strip). */
function scanBracketStackForContext(text: string): string[] {
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
  return stack;
}

/**
 * Render the opener prefix for a continuation chunk so it can stand on
 * its own as a self-renderable markdown fragment. E.g. for an open
 * `` ```python `` fence, returns ` ```python\n `; for an open `**` bold,
 * returns `**`.
 */
export function renderContextOpener(ctx: OpenMarkdownContext): string {
  // Fences are exclusive — if a fence is open, no other markers count
  // (they're inside opaque code).
  if (ctx.fenceLang !== null) {
    return "```" + (ctx.fenceLang ?? "") + "\n";
  }
  let out = "";
  for (const m of ctx.brackets) out += m;
  if (ctx.inlineCode) out += "`";
  return out;
}
