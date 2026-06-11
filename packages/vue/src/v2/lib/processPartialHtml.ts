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
 * FINAL document the Vue renderer assembles (`ensureHead` + `injectCssIntoHtml`
 * in `OpenGenerativeUIRenderer`):
 *
 * 1. HOIST ONLY styles inside a COMPLETE `<head>…</head>` ELEMENT. This mirrors
 *    the final document exactly: `ensureHead` keeps (or synthesizes) the
 *    `<head>` and `injectCssIntoHtml` injects the agent css INTO that head,
 *    immediately before `</head>` — it never relocates any other markup. So
 *    in-head styles stay in the head (before the agent css); everything else —
 *    including a TOP-LEVEL `<style>` that appears before `<body>` with no
 *    enclosing `<head>` — stays in the BODY region (after the head css in
 *    document order). Consequences:
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
 * An UNCLOSED `<head>` whose region reaches a `<body[\s>]` token (with no
 * `</head>` first) is treated as if the head closed at that implicit `<body>`
 * boundary — exactly how a browser renders the final document (`ensureHead` +
 * `injectCssIntoHtml` leave the in-head css in the head and the body content in
 * the body when no `</head>` is emitted). So an in-head style there is hoisted
 * and the body content is kept — content never vanishes. An unclosed `<head>`
 * with content but NO `<body>` token is still stripped (a head that is genuinely
 * still streaming its own content).
 *
 * Pure functions — no DOM, no Vue.
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

  // Head ELEMENT spans, `[start, end)`. `<head\b` is word-bounded so it never
  // matches `<header>`; masking ensures a `<head`/`</head>`/`<body>` token inside
  // CSS/JS or a comment cannot open or close a phantom element here.
  //
  // A head element ends at its `</head>` when one exists. When an opened head has
  // NO `</head>` but its region reaches a `<body[\s>]` token, the head is treated
  // as IMPLICITLY closed at that body boundary (span ends just before `<body>`,
  // which the browser does when rendering the final document) so an in-head style
  // is still hoisted and the body content is preserved. A head opened with no
  // `</head>` and no following `<body>` is genuinely still streaming and yields
  // NO span (the unterminated-block strip step removes it).
  const headElementSpans: Array<[number, number]> = [];
  // Quote-aware open-tag match (same family as the final document's head matcher)
  // so a quoted `>` in a head attribute does not truncate the tag early and a
  // `<body>` inside the head's own attribute (before openEnd) is not seen by the
  // implicit-close search below.
  const headOpenRe = /<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi;
  let headOpen: RegExpExecArray | null;
  while ((headOpen = headOpenRe.exec(masked)) !== null) {
    const openStart = headOpen.index;
    const openEnd = openStart + headOpen[0].length;
    const closeRel = masked.slice(openEnd).search(/<\/head>/i);
    if (closeRel !== -1) {
      const end = openEnd + closeRel + "</head>".length;
      headElementSpans.push([openStart, end]);
      headOpenRe.lastIndex = end;
      continue;
    }
    // No close — fall back to an implicit `<body>` close.
    const bodyRel = masked.slice(openEnd).search(/<body[\s>]/i);
    if (bodyRel !== -1) {
      headElementSpans.push([openStart, openEnd + bodyRel]);
    }
    // Either way there is no further `</head>` to find — stop scanning heads.
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
 * Mirrors the final document (`ensureHead` + `injectCssIntoHtml`): it keeps
 * in-head styles in the head (before the agent css) and leaves every other style
 * — including a top-level pre-`<body>` style — in the body region. Hoisting a
 * body-region or top-level style would flip its cascade position at the
 * preview→final swap, visibly restyling artifacts whose style and the agent css
 * param collide at equal specificity.
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
 *    NOT in any head element and is therefore KEPT, matching the final document,
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
 * 5. Reduce to the body region: drop the `<body…>` open tag and the matching
 *    `</body>` (and everything after it), and drop the `<html…>`/`</html>`
 *    structural wrappers — keeping the body's inner content AND any surviving
 *    top-level pre-`<body>` content (e.g. a body-region `<style>`). This mirrors
 *    how a browser renders the FINAL document's body region: `<html>`/`<head>`
 *    are wrappers the parser drops, while a pre-`<body>` style is real
 *    cascade-bearing content that stays with the body. The `<body[\s>]`/`</body>`
 *    /`<html[\s>]` matches are word-bounded (never `<bodyguard …>`/`<htmlfoo>`)
 *    and run on a freshly masked string so a token inside a surviving style block
 *    or comment cannot fake the boundary. The `<html…>` open tag is stripped
 *    wherever it appears (not only when leading), so a prefixed wrapper —
 *    `text<html>…` — does not leak the tag into the preview body.
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
  // real boundary. Strip </body> (+ everything after) BEFORE the open tag so the
  // open-tag index stays valid for the original string.
  let masked = maskBlockContent(result);
  const closeIdx = masked.search(/<\/body>/i);
  if (closeIdx !== -1) {
    result = result.slice(0, closeIdx);
    masked = maskBlockContent(result);
  }
  const openMatch = masked.match(/<body[\s>]/i);
  if (openMatch && openMatch.index !== undefined) {
    // Remove just the `<body…>` open tag, keeping content before and after it.
    // Quote-aware end-of-tag scan (same shape as the final document's head
    // matcher) so a quoted `>` in an attribute — `<body data-x="a>b">` — can't
    // truncate the tag early and leak attribute fragments as visible content.
    const openTag = masked
      .slice(openMatch.index)
      .match(/^<body(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i);
    const openTagEnd = openTag
      ? openMatch.index + openTag[0].length
      : openMatch.index + masked.slice(openMatch.index).search(/>/) + 1;
    result = result.slice(0, openMatch.index) + result.slice(openTagEnd);
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
