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
 *    of every COMPLETE `<style>`/`<script>` block is replaced with same-length
 *    placeholders. Indices are preserved 1:1, so spans map straight back to the
 *    original. A tag-lookalike token inside CSS/JS — `content:"<body>"`,
 *    `/* hide <body /> default *​/`, `x="</head>"` — therefore can NEVER fake a
 *    boundary or split a style block. Both exported functions derive their
 *    classifications from this ONE computation ({@link analyzeRegions}).
 *
 * The `<body[\s>]` / `</body>` / `<head\b` guards are all word-bounded so
 * `<bodyguard …>`, `<header>`, etc. are never mistaken for `<body>`/`<head>`.
 *
 * Incomplete trailing `<style>`/`<script>`/`<head>` blocks (an open tag with no
 * matching close through end of string) are still stripped entirely — an
 * unterminated block mid-stream must never leak its raw CSS/JS text into the
 * preview body as visible content.
 *
 * Pure functions — no DOM, no React.
 */

/** Matches a COMPLETE `<style>`/`<script>` block, capturing the tag name and its content. */
const COMPLETE_STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * Replaces the CONTENT (between the open tag's `>` and the matching `</tag>`) of
 * every COMPLETE `<style>`/`<script>` block with same-length space placeholders.
 * The tags themselves are untouched. Length-preserving, so every index in the
 * returned string maps 1:1 to the original — callers locate structure on the
 * masked string and slice the matching text out of the original.
 */
function maskBlockContent(html: string): string {
  let out = "";
  let last = 0;
  COMPLETE_STYLE_OR_SCRIPT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMPLETE_STYLE_OR_SCRIPT.exec(html)) !== null) {
    const full = match[0];
    const content = match[2]!;
    // Content starts right after the open tag's first `>`. (Open tags cannot
    // contain a `>` here — these are `<style …>`/`<script …>` with no `>` in
    // their attribute values in any realistic streamed document.)
    const contentStart = match.index + full.indexOf(">") + 1;
    const contentEnd = contentStart + content.length;
    out += html.slice(last, contentStart);
    out += " ".repeat(content.length);
    last = contentEnd;
  }
  out += html.slice(last);
  return out;
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

  // Complete <head>…</head> element spans. `<head\b` is word-bounded so it never
  // matches `<header>`; masking ensures a `<head`/`</head>` token inside CSS/JS
  // cannot open or close a phantom element here.
  const headElementSpans: Array<[number, number]> = [];
  const headRe = /<head\b[^>]*>[\s\S]*?<\/head>/gi;
  let headMatch: RegExpExecArray | null;
  while ((headMatch = headRe.exec(masked)) !== null) {
    headElementSpans.push([
      headMatch.index,
      headMatch.index + headMatch[0].length,
    ]);
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

  // Complete <script> and <head> ELEMENT spans — stripped from the body markup
  // everywhere. (A head element's in-head <style> blocks are contained within
  // these spans, so stripping the element removes the hoisted styles too; we
  // therefore never strip those styles a second time.)
  const scriptOrHeadSpans: Array<[number, number]> = [];
  const scriptOrHeadRe = /<(script|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let shMatch: RegExpExecArray | null;
  while ((shMatch = scriptOrHeadRe.exec(masked)) !== null) {
    scriptOrHeadSpans.push([shMatch.index, shMatch.index + shMatch[0].length]);
  }

  return { scriptOrHeadSpans, styleSpans };
}

/** Removes a set of `[start, end)` spans from `html`, applied right-to-left so
 * earlier offsets stay valid. */
function removeSpans(html: string, spans: Array<[number, number]>): string {
  let out = html;
  for (const [start, end] of [...spans].sort((a, b) => b[0] - a[0])) {
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
 *    block. Complete blocks are already removed (head/script) or intentionally
 *    kept (body/top-level styles), so this only catches a genuinely unterminated
 *    trailing block — raw CSS/JS text must never leak into the preview body.
 * 4. Strip an incomplete HTML entity at the end — e.g. `&amp` without `;`.
 * 5. Reduce to the body region: drop the `<body…>` open tag and the matching
 *    `</body>` (and everything after it), and drop the `<html…>`/`</html>`
 *    structural wrappers — keeping the body's inner content AND any surviving
 *    top-level pre-`<body>` content (e.g. a body-region `<style>`). This mirrors
 *    how a browser renders the FINAL document's body region: `<html>`/`<head>`
 *    are wrappers the parser drops, while a pre-`<body>` style is real
 *    cascade-bearing content that stays with the body. The `<body[\s>]`/`</body>`
 *    matches are word-bounded (never `<bodyguard …>`) and run on a freshly
 *    masked string so a `<body>`/`</body>` token inside a surviving style block
 *    cannot fake the boundary.
 */
export function processPartialHtml(html: string): string {
  const { scriptOrHeadSpans } = analyzeRegions(html);

  // 1. Remove complete <script>/<head> elements (computed on the masked string,
  // applied to the original by index). In-head styles ride along; body/top-level
  // styles are preserved.
  let result = removeSpans(html, scriptOrHeadSpans);

  // 2. Strip an incomplete tag at the very end.
  result = result.replace(/<[^>]*$/, "");

  // 3. Strip an INCOMPLETE (unterminated) trailing <style>/<script>/<head> block
  // — an open tag with no matching close through end of string.
  result = result.replace(
    /<(style|script|head)\b[^>]*>(?:(?!<\/\1>)[\s\S])*$/gi,
    "",
  );

  // 4. Strip an incomplete HTML entity at the end.
  result = result.replace(/&[a-zA-Z0-9#]*$/, "");

  // 5. Reduce to the body region. Mask first so a <body>/</body> token inside a
  // surviving complete style block cannot be mistaken for the real boundary.
  // Strip </body> (+ everything after) BEFORE the open tag so the open-tag
  // index stays valid for the original string.
  let masked = maskBlockContent(result);
  const closeIdx = masked.search(/<\/body>/i);
  if (closeIdx !== -1) {
    result = result.slice(0, closeIdx);
    masked = maskBlockContent(result);
  }
  const openMatch = masked.match(/<body[\s>]/i);
  if (openMatch && openMatch.index !== undefined) {
    // Remove just the `<body…>` open tag, keeping content before and after it.
    // Quote-aware end-of-tag scan (same shape as assembleDocument's head
    // matcher) so a quoted `>` in an attribute — `<body data-x="a>b">` — can't
    // truncate the tag early and leak attribute fragments as visible content.
    const openTag = masked
      .slice(openMatch.index)
      .match(/^<body(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i);
    const openTagEnd = openTag
      ? openMatch.index + openTag[0].length
      : openMatch.index + masked.slice(openMatch.index).search(/>/) + 1;
    result = result.slice(0, openMatch.index) + result.slice(openTagEnd);
  }
  // Drop the `<html…>`/`</html>` structural wrappers (the browser drops them in
  // an innerHTML body context); a pre-`<body>` `<style>` is content and stays.
  result = result.replace(/^<html\b[^>]*>/i, "").replace(/<\/html>/gi, "");

  return result;
}
