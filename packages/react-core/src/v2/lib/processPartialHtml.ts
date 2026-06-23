/**
 * Shared region logic for the Open Generative UI streaming preview.
 *
 * The preview renders accumulated (still-streaming) HTML by hoisting head-region
 * styles into the preview iframe's `<head>` (via {@link extractCompleteStyles})
 * and injecting the body markup via `document.body.innerHTML` (via
 * {@link processPartialHtml}). Those two functions MUST classify every complete
 * `<style>` block identically — a block is either hoisted to the head XOR left
 * in the body, never both (double-injected, cascade flip) and never neither
 * (dropped, unstyled preview).
 *
 * Two principles keep them in lockstep and keep the preview faithful to the
 * FINAL document produced by `assembleDocument`:
 *
 * 1. HOIST ONLY styles inside a COMPLETE `<head>…</head>` ELEMENT. This mirrors
 *    `assembleDocument` exactly: it injects the kit/importmap/agent-css INTO the
 *    existing (or `ensureHead`-synthesized) `<head>` and never relocates any
 *    other markup. So in-head styles stay in the head (before the agent css);
 *    everything else — including a TOP-LEVEL `<style>` that appears before
 *    `<body>` with no enclosing `<head>` — stays in the BODY region (after the
 *    head css in document order). Consequences:
 *      • A complete `<head>` element hoists correctly even when no `<body>` tag
 *        has streamed yet (head/css routinely stream before the body).
 *      • A top-level pre-`<body>` style (no `<head>`) is NEVER hoisted, so the
 *        preview and final document agree with ZERO dependence on `<body>`
 *        detection for the hoist decision.
 *
 * 2. MASK BEFORE MEASURING. Every structural search (locating `<head>` elements,
 *    the `<body[\s>]` boundary, the `</body>` close, `<script>`/`<head>` element
 *    spans) runs on a single shared masked copy of the input where the CONTENT
 *    of every COMPLETE `<style>`/`<script>` block AND every COMPLETE `<!-- … -->`
 *    HTML COMMENT is replaced with same-length placeholders. Indices are
 *    preserved 1:1, so spans map straight back to the original. A tag-lookalike
 *    token inside CSS/JS or inside a comment — `content:"<body>"`,
 *    `/* hide <body /> default *​/`, `x="</head>"`, `<!-- <body> -->`,
 *    `<!-- <script>x</script> -->` — therefore can NEVER fake a boundary, split
 *    a style block, or be mistaken for real structure to strip. Both exported
 *    functions derive their classifications from this ONE computation
 *    ({@link analyzeRegions}).
 *
 * The `<body[\s>]` / `</body>` / `<head\b` / `<html[\s>]` guards are all
 * word-bounded so `<bodyguard …>`, `<header>`, `<htmlfoo>`, etc. are never
 * mistaken for `<body>`/`<head>`/`<html>`.
 *
 * Incomplete trailing `<style>`/`<script>`/`<head>` blocks and an incomplete
 * trailing `<!-- …` comment (an open token with no matching close through end of
 * string) are still stripped entirely — an unterminated block mid-stream must
 * never leak its raw CSS/JS/comment text into the preview body as visible
 * content, and an unterminated comment must never fake structure (it would
 * swallow the rest of the document once `-->` arrives, so the preview drops it
 * to match the final document's effective rendering).
 *
 * 3. HEAD/BODY GEOMETRY MATCHES THE BROWSER. The head-element detection in
 *    `analyzeRegions` partitions the bytes into head vs body exactly where a
 *    browser does when rendering the final document — never crossing the body
 *    boundary, never hoisting body-region content:
 *      • The FIRST masked word-bounded `<body[\s>]` token is the body boundary. A
 *        `<head>` whose open token starts AT OR AFTER it is body content (a stray
 *        `<head>` nested in the body), NOT a head element: its tag tokens are
 *        dropped (step 5) and its content stays in the body, never hoisted.
 *      • A counted head element's CONTENT ends at the FIRST of an explicit
 *        `</head>`, the body boundary, a flow (non-head-permitted) START tag, or
 *        the first non-whitespace TEXT character — the same boundary a browser
 *        uses (see {@link findHeadContentEnd}). The `</head>` pairing therefore
 *        NEVER reaches past a `<body>` token: `<head><style>.a{}</style><body>…`
 *        closes the head at `<body>` (style hoisted, body content kept), it does
 *        not swallow the body up to a trailing `</head>`. An in-head style before
 *        the boundary is hoisted; anything from the boundary on stays in the body.
 *      • A head-permitted element with a text body (`<title>`/`<noscript>`/
 *        `<template>`, plus the masked `<style>`/`<script>`) is skipped to its
 *        close so its inner text (`<title>a < b</title>`) is never read as flow.
 *      • The implicit head close fires at FLOW CONTENT, not only at `<body>`:
 *        `<head><style>.a{}</style><p>x</p>` (no `<body>` ever) renders `<p>x</p>`
 *        with `.a` hoisted, NOT a blank preview. Streaming guard: a head whose
 *        region so far is ONLY head-permitted content with no boundary yet, or a
 *        trailing incomplete tag (`<ti`, a bare `<`), is genuinely still streaming
 *        — it yields NO span (stripped, self-correcting next chunk), so the head
 *        is never closed on an indeterminate tail.
 *      • STRAY head/body tokens are dropped, not leaked: step 5 removes EVERY
 *        `<body[\s>]` open (a browser opens the body once — a duplicate `<body>`
 *        is dropped and its markup stays in the one body), and every stray
 *        `<head[\s>]`/`</head>` token left in the body (a browser drops the stray
 *        tag but KEEPS its content) — all mask-aware and quote-aware, the same
 *        shape as the `</html>` strip.
 *    All four consumers (style hoist containment, the head-element strip, the
 *    duplicate-body strip, the stray-head strip) derive from this ONE geometry, so
 *    the preview body and the hoisted head agree with the final document — a style
 *    is hoisted XOR kept (never both, never neither) and content never vanishes.
 *
 * Pure functions — no DOM, no React.
 */

/**
 * Quote-aware open-tag end scan: from a `<style`/`<script`/`<head` (etc.) start,
 * matches through the tag's `>`, allowing a `>` inside a quoted attribute value
 * (`<style data-x="a>b">`). Used so the masked content boundary is the REAL end
 * of the open tag, not a quoted `>` mid-attribute.
 */
const OPEN_TAG_END = /^<[a-zA-Z][^\s/>]*(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/;

/**
 * Blanks the INSIDES of quoted runs (`"…"` / `'…'`) in a tag string with spaces,
 * length-preserving. A structural-looking token inside an open tag's attribute
 * value — `<style data-x="<body>">`, `<script src="</head>">` — must not be left
 * visible to the structural searches (it would fake a boundary), so its bytes are
 * blanked while the tag skeleton (name + attribute names + delimiters) is kept.
 */
function blankQuotedRuns(tag: string): string {
  return tag.replace(
    /"[^"]*"|'[^']*'/g,
    (q) => q[0] + " ".repeat(q.length - 2) + q[0],
  );
}

/**
 * Replaces the CONTENT of every COMPLETE `<style>`/`<script>` block (between the
 * open tag's real `>` and the matching `</tag>`) and the CONTENT of every
 * COMPLETE `<!-- … -->` comment (between `<!--` and `-->`) with same-length space
 * placeholders, and additionally blanks the quoted attribute values inside those
 * style/script open tags. The delimiting tokens (and attribute skeletons) are
 * untouched. Length-preserving, so every index in the returned string maps 1:1 to
 * the original — callers locate structure on the masked string and slice the
 * matching text out of the original.
 *
 * A single left-to-right pass masks whichever construct opens FIRST at each
 * position, so the three constructs never interfere: a `<style>` mentioned inside
 * a comment is masked as comment content (not treated as a real style), and a
 * `-->` inside CSS is masked as style content (not treated as a comment close).
 */
function maskBlockContent(html: string): string {
  const blockRe = /<style\b|<script\b|<!--/gi;
  let out = "";
  let last = 0;
  blockRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const start = match.index;
    if (start < last) continue; // inside a region already masked
    const token = match[0];
    if (token === "<!--") {
      const close = html.indexOf("-->", start + 4);
      // Content runs from just after `<!--` to just before `-->`. An
      // UNTERMINATED comment masks to end of string: anything after `<!--`
      // would be swallowed by the comment once `-->` arrives, so no tag
      // lookalike inside it (a complete-looking `<style>`, a `<body>`) may be
      // mistaken for real structure. The trailing `<!-- …` is removed from the
      // body by the comment-strip step.
      const contentStart = start + 4;
      const contentEnd = close === -1 ? html.length : close;
      out += html.slice(last, contentStart);
      out += " ".repeat(contentEnd - contentStart);
      last = contentEnd;
      blockRe.lastIndex = close === -1 ? html.length : close + 3;
    } else {
      // <style …> / <script …>. Find the REAL end of the open tag quote-aware
      // (a quoted `>` in an attribute — `<style data-x="a>b">` — must not be
      // mistaken for the end of the open tag), then mask up to the matching
      // close tag. The open tag's quoted attribute VALUES are blanked too so a
      // `<body>`/`</head>` inside one cannot fake a boundary. An unterminated
      // open tag or block masks to end of string and is removed from the body by
      // the unterminated-block strip step.
      const tagName = token.slice(1); // "style" | "script"
      const openEndMatch = html.slice(start).match(OPEN_TAG_END);
      const openEnd = openEndMatch
        ? start + openEndMatch[0].length
        : html.length;
      const closeRe = new RegExp(`</${tagName}>`, "i");
      const closeRel = openEndMatch ? html.slice(openEnd).search(closeRe) : -1;
      const contentEnd = closeRel === -1 ? html.length : openEnd + closeRel;
      out += html.slice(last, start);
      out += blankQuotedRuns(html.slice(start, openEnd));
      out += " ".repeat(contentEnd - openEnd);
      last = contentEnd;
      blockRe.lastIndex =
        closeRel === -1 ? html.length : contentEnd + `</${tagName}>`.length;
    }
  }
  out += html.slice(last);
  return out;
}

/**
 * Element names a browser keeps INSIDE `<head>` (HTML "metadata content" plus the
 * elements the head parser tolerates). Encountering a START tag whose name is NOT
 * in this set — word-bounded — is flow content and implicitly CLOSES the head, the
 * same boundary a browser uses when no `</head>` is emitted. Lower-cased; callers
 * compare against a lower-cased tag name.
 */
const HEAD_PERMITTED = new Set([
  "title",
  "meta",
  "link",
  "style",
  "script",
  "base",
  "noscript",
  "template",
]);

/** Head-permitted elements that have NO end tag (void) — their open tag is the
 * whole element, so the head scan skips just the tag, never hunts a close. */
const HEAD_VOID = new Set(["meta", "link", "base"]);

/**
 * Finds where an open `<head>` region's CONTENT ends, scanning the MASKED string
 * from just after the head open tag (`openEnd`). Mirrors how a browser partitions
 * the bytes into head vs body when rendering the final document: the head ends at
 * the FIRST of —
 *   • an explicit `</head>` close token,
 *   • a masked word-bounded `<body[\s>]` open token (the implicit body boundary),
 *   • a START tag whose name is NOT head-permitted (flow content — `<div>`, `<p>`,
 *     a stray `<html>`, …), or
 *   • the first non-whitespace TEXT character outside any tag token.
 * A head-permitted element with a text body (`<title>`, `<noscript>`, `<template>`,
 * and the already-masked `<style>`/`<script>`) is SKIPPED to its matching close so
 * its inner text — `<title>a < b</title>` — is never mistaken for flow content
 * (RCDATA/raw-text parity with the browser). Head-permitted VOID tags
 * (`<meta>`/`<link>`/`<base>`) skip just the tag.
 *
 * Returns the index in the original/masked string where head content ends (the
 * span is `[openStart, end)`; an explicit `</head>` is NOT included — the stray
 * `</head>` strip removes it, the same shape as the `</html>` strip). Returns
 * `null` when the head is GENUINELY STILL STREAMING its own content — content so
 * far is only head-permitted and the scan runs off the end of the string, OR a
 * head-permitted text element is unterminated, OR the tail is an incomplete tag
 * prefix (`<ti`, a bare `<`). A `null` yields NO head span, so the unterminated-
 * block strip removes the head region (preview empty until more streams in), which
 * self-corrects on the next chunk — never closing the head on an indeterminate
 * trailing tag.
 */
function findHeadContentEnd(masked: string, openEnd: number): number | null {
  let i = openEnd;
  const len = masked.length;
  while (i < len) {
    const ch = masked[i]!;
    if (ch !== "<") {
      // Whitespace stays in the head; the first non-whitespace text char is flow
      // content and closes the head. (Masked spans are all spaces, so style/script/
      // comment content never reads as flow text here.)
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      return i;
    }
    // ch === "<": a tag-ish token. Distinguish close tags, comments, the body
    // boundary, head-permitted elements, and flow start tags.
    const rest = masked.slice(i);
    // Explicit </head> close ends the head here.
    if (/^<\/head[\s>]/i.test(rest) || /^<\/head>/i.test(rest)) {
      return i;
    }
    // The implicit body boundary.
    if (/^<body[\s>]/i.test(rest)) {
      return i;
    }
    // A complete HTML comment stays in the head (metadata-adjacent); skip it.
    // (Comment INSIDES are masked to spaces, but the `<!--`/`-->` delimiters are
    // intact, so we can locate the close.)
    if (rest.startsWith("<!--")) {
      const close = masked.indexOf("-->", i + 4);
      if (close === -1) return null; // unterminated trailing comment → still streaming
      i = close + 3;
      continue;
    }
    // An incomplete trailing close tag (`</hea`, `</di` with no `>` at end of
    // string) is indeterminate mid-stream — defer rather than guess.
    if (/^<\/[a-zA-Z][^>]*$/.test(rest)) {
      return null;
    }
    // Any other COMPLETE close tag (e.g. a stray </p>, </div>) is tolerated inside
    // the head by the parser without opening the body; skip it.
    const closeMatch = rest.match(/^<\/([a-zA-Z][^\s/>]*)\s*>/);
    if (closeMatch) {
      i += closeMatch[0].length;
      continue;
    }
    // A START tag: read its name (word-bounded). An INCOMPLETE trailing tag prefix
    // (`<ti`, `<style` / `<div` with no `>`) is indeterminate mid-stream — defer,
    // never closing the head on it (the trailing-tag handling self-corrects next
    // chunk). A COMPLETE start tag that is NOT head-permitted is flow content.
    // A lone trailing `<` (last char) could still grow into a tag next chunk —
    // indeterminate, defer (the spec's `<` "at end" guard). A `<` followed by a
    // non-tag-name char (`< b`, `<=x`) can NEVER become a tag, so it is text and
    // closes the head (browser parity: such a `<` renders as literal text).
    if (i === len - 1) {
      return null;
    }
    const startMatch = rest.match(/^<([a-zA-Z][^\s/>]*)/);
    if (!startMatch) {
      // `<` followed by a non-tag-name char (e.g. `< b`, `<=x`). The browser treats
      // it as literal text, which closes the head here.
      return i;
    }
    const openTagMatch = rest.match(OPEN_TAG_END);
    if (!openTagMatch) {
      // The start tag has no closing `>` yet — incomplete trailing tag → defer.
      return null;
    }
    const name = startMatch[1]!.toLowerCase();
    if (!HEAD_PERMITTED.has(name)) {
      // Complete flow start tag → implicit head close at this token.
      return i;
    }
    // Head-permitted start tag, already known to be complete (openTagMatch).
    const tagEnd = i + openTagMatch[0].length;
    if (HEAD_VOID.has(name)) {
      // Void head element (meta/link/base) — no end tag; skip just the open tag.
      i = tagEnd;
      continue;
    }
    // Non-void head-permitted element (title/noscript/template/style/script): skip
    // to its matching close so its inner text isn't read as flow. style/script
    // content is already masked, but title/noscript/template content is not — the
    // skip-to-close handles all of them uniformly. Unterminated ⇒ still streaming.
    const closeRe = new RegExp(`</${name}\\s*>`, "i");
    const closeRel = masked.slice(tagEnd).search(closeRe);
    if (closeRel === -1) return null;
    const closeMatchInner = masked.slice(tagEnd + closeRel).match(closeRe)!;
    i = tagEnd + closeRel + closeMatchInner[0].length;
  }
  // Ran off the end with only head-permitted content and no boundary → the head is
  // still streaming its own content; yield no span (stripped, self-corrects).
  return null;
}

interface StyleSpan {
  /** Start index of the complete `<style>` block in the ORIGINAL string. */
  start: number;
  /** End index (exclusive) of the complete `<style>` block in the ORIGINAL string. */
  end: number;
  /** True when the block lies entirely within a complete `<head>…</head>` element. */
  inHead: boolean;
}

interface Regions {
  /** `[start, end)` spans of complete `<script>`/`<head>` ELEMENTS (stripped from the body everywhere). */
  scriptOrHeadSpans: Array<[number, number]>;
  /** Every complete `<style>` block, tagged with whether it sits inside a `<head>` element. */
  styleSpans: StyleSpan[];
}

/**
 * The single shared region computation. Masks complete `<style>`/`<script>`
 * content (see {@link maskBlockContent}), then derives every structural fact
 * from that ONE masked string so both exported functions agree by construction.
 */
function analyzeRegions(html: string): Regions {
  const masked = maskBlockContent(html);

  // The FIRST masked word-bounded `<body[\s>]` open token is the body boundary —
  // the geometric line a browser draws between head and body. A `<head>` whose
  // open token starts AT OR AFTER this line is body content (a stray `<head>`
  // inside the body), not a head element: its tag tokens are dropped from the body
  // (step 5) and its inner content is kept where it sits, never hoisted. Located
  // on the masked string so a `<body>` inside CSS/JS or a comment cannot fake it.
  const firstBodyOpenMatch = masked.match(/<body[\s>]/i);
  const firstBodyOpen =
    firstBodyOpenMatch && firstBodyOpenMatch.index !== undefined
      ? firstBodyOpenMatch.index
      : Infinity;

  // Head ELEMENT spans, `[start, end)`. `<head\b` is word-bounded so it never
  // matches `<header>`; masking ensures a `<head`/`</head>`/`<body>` token inside
  // CSS/JS or a comment cannot open or close a phantom element here.
  //
  // GEOMETRY (browser-parity with the final document): a head element counts only
  // when its OPEN token starts BEFORE the body boundary (`firstBodyOpen`). Its
  // CONTENT ends — via {@link findHeadContentEnd} — at the FIRST of an explicit
  // `</head>`, the body boundary, a flow (non-head-permitted) start tag, or
  // non-whitespace text — exactly where the browser closes the head. The span is
  // `[openStart, contentEnd)` and EXCLUDES any explicit `</head>` token (the stray
  // `</head>` strip in step 5 removes it, the same mask-aware shape as `</html>`).
  // A `null` content end means the head is genuinely still streaming its own
  // head-permitted content with no boundary yet — NO span (the unterminated-block
  // strip removes it; the preview self-corrects on the next chunk).
  const headElementSpans: Array<[number, number]> = [];
  // Quote-aware open-tag match (same family as assembleDocument's head matcher)
  // so a quoted `>` in a head attribute does not truncate the tag early and a
  // `<body>` inside the head's own attribute (before openEnd) is not seen by the
  // content-end search below.
  const headOpenRe = /<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi;
  let headOpen: RegExpExecArray | null;
  while ((headOpen = headOpenRe.exec(masked)) !== null) {
    const openStart = headOpen.index;
    // A `<head>` at or past the body boundary is body content, not a head element.
    if (openStart >= firstBodyOpen) break;
    const openEnd = openStart + headOpen[0].length;
    const contentEnd = findHeadContentEnd(masked, openEnd);
    if (contentEnd !== null) {
      headElementSpans.push([openStart, contentEnd]);
      headOpenRe.lastIndex = contentEnd;
      continue;
    }
    // Still-streaming head (no boundary yet) — no span; stop scanning heads.
    break;
  }

  // Every complete <style> block, tagged by containment in a head element. A
  // block is "in head" only if its whole span sits inside one head element span.
  const styleSpans: StyleSpan[] = [];
  const styleRe = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRe.exec(masked)) !== null) {
    const start = styleMatch.index;
    const end = styleMatch.index + styleMatch[0].length;
    const inHead = headElementSpans.some(
      ([hs, he]) => start >= hs && end <= he,
    );
    styleSpans.push({ start, end, inHead });
  }

  // Complete <script> ELEMENT spans — stripped from the body markup everywhere.
  const scriptSpans: Array<[number, number]> = [];
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRe.exec(masked)) !== null) {
    scriptSpans.push([
      scriptMatch.index,
      scriptMatch.index + scriptMatch[0].length,
    ]);
  }

  // <script> AND <head> ELEMENT spans are both stripped from the body markup.
  // (A head element's in-head <style> blocks are contained within its span, so
  // stripping the element removes the hoisted styles too; we therefore never
  // strip those styles a second time. The implicit-close head span is included
  // here as well, so an unclosed-head-with-body strips its head region — keeping
  // the in-head style hoisted XOR present, never both.)
  const scriptOrHeadSpans = [...scriptSpans, ...headElementSpans];

  return { scriptOrHeadSpans, styleSpans };
}

/** Removes a set of `[start, end)` spans from `html`. Spans are coalesced first
 * (a `<script>` nested inside a `<head>` element yields a script span contained
 * in the head span — overlapping/contained ranges must be merged or a
 * right-to-left splice would use a stale offset), then applied right-to-left so
 * earlier offsets stay valid. */
function removeSpans(html: string, spans: Array<[number, number]>): string {
  if (spans.length === 0) return html;
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const lastMerged = merged[merged.length - 1];
    if (lastMerged && start <= lastMerged[1]) {
      lastMerged[1] = Math.max(lastMerged[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  let out = html;
  for (let i = merged.length - 1; i >= 0; i--) {
    const [start, end] = merged[i]!;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

/**
 * Extracts the complete `<style>` blocks that should be HOISTED into the preview
 * iframe's `<head>` — i.e. ONLY those inside a complete `<head>…</head>` element
 * (see the head-element rule in this module's header). Returns the concatenated
 * style tags, suitable for injection into `<head>`.
 *
 * Mirrors `assembleDocument`: it keeps in-head styles in the head (before the
 * agent css) and leaves every other style — including a top-level pre-`<body>`
 * style — in the body region. Hoisting a body-region or top-level style would
 * flip its cascade position at the preview→final swap, visibly restyling
 * artifacts whose style and the agent css param collide at equal specificity.
 *
 * Derived from the shared {@link analyzeRegions} computation, so it classifies
 * every complete `<style>` exactly as {@link processPartialHtml} does — the
 * hoisted set here is precisely the set stripped from the body there.
 */
export function extractCompleteStyles(html: string): string {
  const { styleSpans } = analyzeRegions(html);
  return styleSpans
    .filter((span) => span.inHead)
    .map((span) => html.slice(span.start, span.end))
    .join("");
}

/**
 * Processes raw accumulated HTML into the markup injected via the preview's
 * `document.body.innerHTML`. Pure function, no DOM dependencies.
 *
 * Pipeline (all structural detection comes from the shared {@link analyzeRegions}
 * computation, so it agrees with {@link extractCompleteStyles} by construction):
 * 1. Remove complete `<script>`/`<head>` ELEMENTS everywhere. Stripping a head
 *    element also removes its in-head `<style>` blocks — exactly the blocks
 *    {@link extractCompleteStyles} hoists — so those styles live in the head XOR
 *    the body, never both. A top-level pre-`<body>` style (no enclosing head) is
 *    NOT in any head element and is therefore KEPT, matching `assembleDocument`,
 *    which leaves it in the body region.
 * 2. Strip an incomplete tag at the very end — e.g. `<div class="fo`.
 * 3. Strip an incomplete (unterminated) trailing `<style>`/`<script>`/`<head>`
 *    block AND an incomplete trailing `<!-- …` comment. Complete blocks/comments
 *    are already removed (head/script) or masked/intentionally kept (body styles,
 *    complete comments), so this only catches a genuinely unterminated trailing
 *    construct — raw CSS/JS text must never leak into the preview body, and an
 *    unterminated comment must vanish (the final document's `-->` would swallow
 *    the remainder, so the preview shows nothing for it).
 * 4. Strip an incomplete HTML entity at the end — e.g. `&amp` without `;`. BY
 *    DESIGN this also drops a trailing run of LITERAL text that merely looks
 *    like a developing entity (a chunk ending `<p>R&D` renders as `<p>R`, since
 *    `&D` is indistinguishable from a forming `&Dagger;` at the boundary); the
 *    conservative strip self-corrects on the next chunk and at completion (the
 *    FINAL document never runs processPartialHtml).
 * 5. Reduce to the body region: drop EVERY `<body…>` open tag and EVERY `</body…>`
 *    CLOSE TOKEN (but KEEP everything around/after them), drop every stray
 *    `<head…>`/`</head>` token left in the body, and drop the `<html…>`/`</html>`
 *    structural wrappers — keeping the body's inner content, any surviving
 *    top-level pre-`<body>` content (e.g. a body-region `<style>`), the content of
 *    a stray body-region `<head>` (its tags dropped, content kept), AND any
 *    content after `</body>`. This mirrors how a browser renders the FINAL
 *    document's body region: `<html>`/`<head>`/`<body>`/`</body>`/`</html>` are
 *    tags the parser consumes as structure (a DUPLICATE `<body>` and a stray
 *    `<head>`/`</head>` are dropped tags, not visible text), while a pre-`<body>`
 *    style and any post-`</body>` markup are real content the browser REPARENTS
 *    into the body (the final document is mounted whole, so the preview must keep
 *    them too — a truncate-at-`</body>` drops content that pops in at the swap).
 *    The `<body[\s>]`/`</body>`/`<html[\s>]` matches are word-bounded (never
 *    `<bodyguard …>`/`<htmlfoo>`) and run on a freshly masked string so a token
 *    inside a surviving style block or comment cannot fake the boundary. The
 *    `</body>` and `<html…>` tokens are stripped wherever they appear (not only
 *    when leading/trailing), so a prefixed wrapper — `text<html>…` — does not
 *    leak the tag into the preview body, and post-`</body>` content is retained.
 */
export function processPartialHtml(html: string): string {
  const { scriptOrHeadSpans } = analyzeRegions(html);

  // 1. Remove complete <script>/<head> elements (computed on the masked string,
  // applied to the original by index). In-head styles ride along; body/top-level
  // styles are preserved.
  let result = removeSpans(html, scriptOrHeadSpans);

  // Steps 2–3 locate the trailing-incomplete cut point on a MASKED copy so a
  // `<`, `<style`/`<head`/`<!--` token inside a COMPLETE style block's content or
  // a quoted attribute value cannot be mistaken for a genuinely unterminated
  // trailing construct; the cut is then applied to the original by index.
  let trimMask = maskBlockContent(result);

  // 2. Strip an incomplete tag at the very end (e.g. `<div class="fo`).
  const incompleteTag = trimMask.search(/<[^>]*$/);
  if (incompleteTag !== -1) {
    result = result.slice(0, incompleteTag);
    trimMask = maskBlockContent(result);
  }

  // 3. Strip an INCOMPLETE (unterminated) trailing <!-- … comment, then an
  // unterminated trailing <style>/<script>/<head> block. The unterminated
  // construct masks to end-of-string in maskBlockContent, so its open token
  // remains the only structural marker on the masked copy at the tail; complete
  // blocks (with their close tags) never match here.
  const incompleteComment = trimMask.search(/<!--(?:(?!-->)[\s\S])*$/);
  if (incompleteComment !== -1) {
    result = result.slice(0, incompleteComment);
    trimMask = maskBlockContent(result);
  }
  const incompleteBlock = trimMask.search(
    /<(style|script|head)\b[^>]*>(?:(?!<\/\1>)[\s\S])*$/i,
  );
  if (incompleteBlock !== -1) {
    result = result.slice(0, incompleteBlock);
  }

  // 4. Strip an incomplete HTML entity at the end.
  result = result.replace(/&[a-zA-Z0-9#]*$/, "");

  // 5. Reduce to the body region. Mask first so a <body>/</body>/<html> token
  // inside a surviving complete style block or comment cannot be mistaken for the
  // real boundary. Remove the </body> CLOSE TOKEN(S) but KEEP the content after
  // them — a browser reparents any markup that appears after </body> back INTO
  // the body when it renders the final (whole-document) mount, so truncating at
  // </body> would drop content the final document still shows (a preview↔final
  // divergence where post-</body> content pops in at the swap). A complete
  // <style> after </body> is body-region too (it sits in no <head> element), so
  // analyzeRegions does not hoist it and it stays here in the body — preserving
  // the hoist-XOR-keep invariant. Locate each </body> on the MASKED copy (so a
  // </body> token inside a surviving style/comment is never taken as the
  // structural close) and splice those spans out of the ORIGINAL by index — the
  // same mask-aware shape as the </html> strip below. Done before the <body>
  // open-tag step so its offsets stay valid for the post-removal string.
  let masked = maskBlockContent(result);
  const bodyCloseSpans: Array<[number, number]> = [];
  const bodyCloseRe = /<\/body>/gi;
  let bodyClose: RegExpExecArray | null;
  while ((bodyClose = bodyCloseRe.exec(masked)) !== null) {
    bodyCloseSpans.push([
      bodyClose.index,
      bodyClose.index + bodyClose[0].length,
    ]);
  }
  if (bodyCloseSpans.length > 0) {
    result = removeSpans(result, bodyCloseSpans);
    masked = maskBlockContent(result);
  }
  // Remove EVERY `<body…>` open tag, keeping content before and after each. A
  // browser opens the body only once; a SECOND `<body>` open token is ignored
  // (its attributes merge, the tag itself is dropped) and the following markup
  // stays in the one body — `<body><p>a</p><body><p>b</p>` renders `<p>a</p><p>b</p>`.
  // Removing only the first open would leak the duplicate `<body>` as literal
  // text, so we loop, locating each open on a freshly masked copy (a `<body>`
  // inside a surviving style/comment never counts) with the same quote-aware
  // end-of-tag scan (so a quoted `>` — `<body data-x="a>b">` — can't truncate the
  // tag early and leak attribute fragments).
  const bodyOpenSpans: Array<[number, number]> = [];
  const bodyOpenRe = /<body[\s>]/gi;
  let bodyOpen: RegExpExecArray | null;
  while ((bodyOpen = bodyOpenRe.exec(masked)) !== null) {
    const start = bodyOpen.index;
    const openTag = masked
      .slice(start)
      .match(/^<body(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i);
    const end = openTag
      ? start + openTag[0].length
      : start + masked.slice(start).search(/>/) + 1;
    bodyOpenSpans.push([start, end]);
    bodyOpenRe.lastIndex = end;
  }
  if (bodyOpenSpans.length > 0) {
    result = removeSpans(result, bodyOpenSpans);
    masked = maskBlockContent(result);
  }
  // Drop EVERY stray `<head…>` open token and `</head>` close token left in the
  // body. analyzeRegions already stripped the head ELEMENTS it counted (those
  // whose open token is before the body boundary), so any `<head>`/`</head>` token
  // surviving here is body content: a `<head>` nested inside `<body>`, or the
  // explicit `</head>` of a counted head (whose tag the head span deliberately
  // excluded). A browser drops these stray tags but KEEPS their inner content —
  // `<body><head><style>.b{}</style></head><p>x</p>` renders
  // `<style>.b{}</style><p>x</p>`; a trailing standalone `</head>` after the body
  // (`<div>real</div></head>`) is dropped, not shown as literal text. Mask-aware +
  // quote-aware, the same shape as the `</html>` strip. (Done before the `<html>`
  // strips for symmetry; order is immaterial since all are span-based.)
  const headTokenSpans: Array<[number, number]> = [];
  const headOpenStrayRe = /<head[\s>]/gi;
  let headOpenStray: RegExpExecArray | null;
  while ((headOpenStray = headOpenStrayRe.exec(masked)) !== null) {
    const start = headOpenStray.index;
    const openTag = masked
      .slice(start)
      .match(/^<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i);
    const end = openTag
      ? start + openTag[0].length
      : start + masked.slice(start).search(/>/) + 1;
    headTokenSpans.push([start, end]);
    headOpenStrayRe.lastIndex = end;
  }
  const headCloseStrayRe = /<\/head\s*>/gi;
  let headCloseStray: RegExpExecArray | null;
  while ((headCloseStray = headCloseStrayRe.exec(masked)) !== null) {
    headTokenSpans.push([
      headCloseStray.index,
      headCloseStray.index + headCloseStray[0].length,
    ]);
  }
  if (headTokenSpans.length > 0) {
    result = removeSpans(result, headTokenSpans);
    masked = maskBlockContent(result);
  }
  // Drop the `<html…>` open tag wherever it appears (the browser drops the
  // wrapper in an innerHTML body context); a pre-`<body>` `<style>` is content
  // and stays. Quote-aware end-of-tag scan + masked search so an `<html>` token
  // inside a surviving style/comment cannot fake it, and a prefixed wrapper
  // (`text<html>…`) is handled, not just a leading one.
  const htmlOpen = masked.match(/<html[\s>]/i);
  if (htmlOpen && htmlOpen.index !== undefined) {
    const openTag = masked
      .slice(htmlOpen.index)
      .match(/^<html(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i);
    const openTagEnd = openTag
      ? htmlOpen.index + openTag[0].length
      : htmlOpen.index + masked.slice(htmlOpen.index).search(/>/) + 1;
    result = result.slice(0, htmlOpen.index) + result.slice(openTagEnd);
    masked = maskBlockContent(result);
  }
  // Drop the `</html…>` close tag wherever it appears, mask-aware like every
  // other structural op here. Locate each `</html>` on the MASKED copy (so a
  // `</html>` token inside a SURVIVING complete style/comment block or a quoted
  // attribute value is never seen as the wrapper close) and slice those spans
  // out of the ORIGINAL by index. A plain `result.replace(/<\/html>/gi, "")`
  // would run on the UNMASKED string and wrongly delete such a token from
  // content the final document keeps (e.g. `content:"</html>"`).
  const htmlCloseSpans: Array<[number, number]> = [];
  const htmlCloseRe = /<\/html>/gi;
  let htmlClose: RegExpExecArray | null;
  while ((htmlClose = htmlCloseRe.exec(masked)) !== null) {
    htmlCloseSpans.push([
      htmlClose.index,
      htmlClose.index + htmlClose[0].length,
    ]);
  }
  result = removeSpans(result, htmlCloseSpans);

  return result;
}
