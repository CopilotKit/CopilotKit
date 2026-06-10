/**
 * Returns the HEAD region of `html` — the substring before the first real
 * `<body[\s>]` opening tag (case-insensitive). Returns `""` when no `<body` tag
 * exists, because `processPartialHtml` then treats the WHOLE string as the body
 * region (so there is no head region at all).
 *
 * Complete `<script>` blocks are stripped FIRST so a `<body` that only appears
 * as text inside a script (e.g. `<script>x="<body>"</script>`) can never be
 * mistaken for the real body boundary. `<head>` blocks are deliberately NOT
 * stripped: a `<style>` wrapped in `<head>…</head>` is still head-region and
 * must be hoisted (and `processPartialHtml` removes that same style as part of
 * its complete-`<head>`-block strip, so the two functions stay in agreement —
 * no style is ever both hoisted and left behind, or dropped from both).
 *
 * The `<body[\s>]` guard matches `<body>`/`<body …>` but never `<bodysomething>`.
 */
function headRegion(html: string): string {
  const withoutScripts = html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    "",
  );
  const match = withoutScripts.match(/<body[\s>]/i);
  if (!match || match.index === undefined) return "";
  return withoutScripts.slice(0, match.index);
}

/**
 * Extracts complete `<style>…</style>` blocks ONLY from the HEAD region of the
 * raw HTML — everything before the first `<body[\s>]` tag (case-insensitive).
 * When no `<body` tag exists, there is no head region (the whole string is the
 * body region per `processPartialHtml`), so nothing is hoisted. Returns the
 * concatenated head-region style tags, suitable for injection into `<head>`.
 *
 * WHY region-aware: the streaming preview injects the returned styles into the
 * preview iframe's `<head>`, while `processPartialHtml` leaves complete
 * body-region `<style>` blocks in the preview body. This mirrors the final
 * document (`assembleDocument`), which keeps body-region styles in the body
 * (after the head css in document order) and only places head content in the
 * head. Hoisting EVERY style — including body ones — would flip a body style's
 * cascade position at the preview→final swap, visibly restyling artifacts whose
 * body `<style>` and the agent css param collide at equal specificity.
 */
export function extractCompleteStyles(html: string): string {
  const matches = headRegion(html).match(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
  return matches ? matches.join("") : "";
}

/**
 * Processes raw accumulated HTML for safe preview via innerHTML injection.
 * Pure function, no DOM dependencies.
 *
 * Pipeline (order matters):
 * 1. Strip incomplete tag at end
 * 2. Strip complete <style> blocks in the HEAD region (before the first
 *    `<body[\s>]`); strip complete <script>/<head> blocks everywhere
 * 3. Strip incomplete <style>/<script>/<head> blocks
 * 4. Strip incomplete HTML entities
 * 5. Extract body content (or use full string if no <body>)
 *
 * Region semantics for `<style>` blocks: complete head-region styles are
 * stripped here because `extractCompleteStyles` hoists them into the preview
 * `<head>`. Complete BODY-region styles are deliberately KEPT in the returned
 * markup — browsers apply `<style>` anywhere, and the final document
 * (`assembleDocument`) likewise leaves body-region styles in the body (after the
 * head css in document order). Keeping them here gives the preview the same
 * cascade as the final document, so styles never shift position at the
 * preview→final swap. Incomplete trailing `<style>` blocks are still stripped
 * entirely in EITHER region: an unterminated `<style>` mid-stream must never
 * leak its raw CSS text into the preview body as visible content.
 */
export function processPartialHtml(html: string): string {
  let result = html;

  // 1. Strip incomplete tag at end — e.g. `<div class="fo`
  result = result.replace(/<[^>]*$/, "");

  // 2a. Strip complete <script> and <head> blocks everywhere.
  result = result.replace(/<(script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  // 2b. Strip complete <style> blocks ONLY in the head region (everything
  // before the first `<body[\s>]`). They are hoisted to the preview <head> by
  // extractCompleteStyles. Complete body-region <style> blocks stay in place so
  // the preview cascade matches the final document. When there is no <body>,
  // the whole string is the body region, so no complete styles are stripped
  // here. The `<script>`/`<head>` blocks are already gone (step 2a), so this
  // body-boundary search sees the SAME script/head-stripped text as the shared
  // `headRegion` helper — the two functions therefore classify every complete
  // <style> identically (none hoisted-and-kept, none dropped from both).
  const bodyMatch2b = result.match(/<body[\s>]/i);
  if (bodyMatch2b && bodyMatch2b.index !== undefined && bodyMatch2b.index > 0) {
    const bodyStart = bodyMatch2b.index;
    const head = result
      .slice(0, bodyStart)
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    result = head + result.slice(bodyStart);
  }

  // 3. Strip an INCOMPLETE (unterminated) <style>/<script>/<head> block at the
  // end — an opening tag with no matching close tag through end of string. The
  // negative-lookahead guard `(?!</\1>)` makes this match ONLY when no closing
  // tag follows, so complete body-region <style> blocks (kept by step 2b) are
  // preserved while a truly unterminated trailing block in EITHER region is
  // removed entirely — raw CSS/JS text must never leak into the preview body.
  result = result.replace(
    /<(style|script|head)\b[^>]*>(?:(?!<\/\1>)[\s\S])*$/gi,
    "",
  );

  // 4. Strip incomplete HTML entities — e.g. `&amp` without semicolon
  result = result.replace(/&[a-zA-Z0-9#]*$/, "");

  // 5. Extract body content
  const bodyMatch = result.match(/<body[^>]*>([\s\S]*)/i);
  if (bodyMatch) {
    result = bodyMatch[1]!;
    // Strip </body> and everything after
    result = result.replace(/<\/body>[\s\S]*/i, "");
  }

  return result;
}
