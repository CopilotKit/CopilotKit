/**
 * Pinned ES-module importmap entries for Open Generative UI sandboxes.
 * Bare specifiers (e.g. "three") and trailing-slash forms (e.g. "three/")
 * are both registered so sub-path imports (e.g. "three/examples/jsm/…")
 * resolve correctly against the pinned version.
 */
export const DEFAULT_OPEN_GEN_UI_LIBRARIES: Record<string, string> = {
  three: "https://esm.sh/three@0.180.0",
  "three/": "https://esm.sh/three@0.180.0/",
  gsap: "https://esm.sh/gsap@3.13.0",
  "gsap/": "https://esm.sh/gsap@3.13.0/",
  d3: "https://esm.sh/d3@7.9.0",
  "d3/": "https://esm.sh/d3@7.9.0/",
  "chart.js": "https://esm.sh/chart.js@4.5.0",
  "chart.js/": "https://esm.sh/chart.js@4.5.0/",
};

/**
 * Merges user-supplied importmap overrides over a set of defaults, keeping the
 * bare specifier and its trailing-slash subpath sibling pinned to the SAME
 * version.
 *
 * The defaults register every pre-wired library as a PAIR — a bare specifier
 * (`three`) and a trailing-slash subpath form (`three/`) — both pinned to one
 * version, because the tool guidance tells the model to use BOTH forms
 * (`import * as THREE from "three"` AND `three/examples/jsm/…`). A naive flat
 * spread (`{ ...defaults, ...overrides }`) re-pins only the bare key the user
 * passed, leaving its `lib/` sibling on the stale default version — so a
 * generated scene would load two different copies of the same library in one
 * sandbox (instanceof failures, duplicate singletons).
 *
 * Semantics:
 * - Start from `{ ...defaults, ...overrides }`.
 * - For every override key `K` that does NOT end with `/`, where `defaults`
 *   has a `K + "/"` sibling and `overrides` did NOT explicitly provide
 *   `K + "/"`: set `K + "/"` to the override URL with a single trailing slash
 *   inserted into the PATH — before any `?` query string or `#` fragment
 *   (appended only if that path part does not already end with one). esm.sh
 *   query idioms like `?bundle` are routine, so appending the slash after the
 *   query (`…three@x?bundle/`) would yield a broken subpath URL.
 * - Explicit user `K/` entries always win (never clobbered by derivation).
 * - New libraries with no default sibling get no invented `K/` entry.
 * - Override keys that themselves end in `/` are treated as plain entries.
 *
 * Pure function — no DOM, no React. Does not mutate its arguments.
 */
export function mergeLibraries(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...defaults, ...overrides };

  for (const key of Object.keys(overrides)) {
    if (key.endsWith("/")) continue;
    const slashKey = key + "/";
    // Only re-pin a subpath sibling that the DEFAULTS define; never invent one
    // for a brand-new library. An explicit override of `slashKey` always wins.
    if (
      Object.prototype.hasOwnProperty.call(defaults, slashKey) &&
      !Object.prototype.hasOwnProperty.call(overrides, slashKey)
    ) {
      const url = overrides[key];
      // Insert the subpath slash into the PATH, before any query (`?`) or
      // fragment (`#`) — whichever comes first. A pure string split (no URL
      // constructor) keeps relative-protocol and exotic specifiers unharmed.
      // Appending the slash after a query (`…?bundle/`) would break the URL,
      // and esm.sh query idioms (`?bundle`, `?dev`, `?target=es2022`) are
      // routine.
      const qIdx = url.indexOf("?");
      const hIdx = url.indexOf("#");
      const sepIdx =
        qIdx === -1 ? hIdx : hIdx === -1 ? qIdx : Math.min(qIdx, hIdx);
      const path = sepIdx === -1 ? url : url.slice(0, sepIdx);
      const rest = sepIdx === -1 ? "" : url.slice(sepIdx);
      merged[slashKey] = path.endsWith("/") ? url : path + "/" + rest;
    }
  }

  return merged;
}

/**
 * Options for `assembleDocument`.
 */
export interface AssembleDocumentOptions {
  /** The dedicated `css` tool parameter (agent-authored). Injected before </head>, after the kit. */
  css?: string;
  /** Resolved design-system CSS, or false to skip injection (legacy behavior). */
  designSystemCss?: string | false;
  /** Resolved importmap entries, or false to skip the importmap (legacy behavior). */
  importMap?: Record<string, string> | false;
}

/**
 * Builds an HTML `<script type="importmap">` tag from the given library map.
 * The map is serialised as `{ imports: libs }` per the importmap spec.
 * Every `<` is escaped inside the serialized JSON (a lossless encoding) so a
 * URL containing `</script>` cannot terminate the importmap tag early.
 */
export function buildImportMapScript(libs: Record<string, string>): string {
  const json = JSON.stringify({ imports: libs }).replace(/</g, "\\u003c");
  return `<script type="importmap">${json}</script>`;
}

/**
 * Ensures the HTML string contains a `<head>` element.
 * If no `<head>` tag is found, prepends `<head></head>` to the string.
 * Ported byte-equivalently from `OpenGenerativeUIRenderer.tsx`.
 */
export function ensureHead(html: string): string {
  if (/<head[\s>]/i.test(html)) return html;
  return `<head></head>${html}`;
}

/** Quote-aware open-tag end scan: from a `<style`/`<script` start, matches
 * through the tag's `>`, allowing a `>` inside a quoted attribute value. */
const ASSEMBLE_OPEN_TAG_END =
  /^<[a-zA-Z][^\s/>]*(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/;

/** Quote-aware head-open matcher: matches `<head>` or `<head` + a whitespace-led
 * attribute span ending in `>` (excluding `<header …>`). Unquoted runs forbid
 * `<`/`>` (so the tag can never greedily swallow a following `<tag>`), while
 * quoted runs (`"…"` / `'…'`) may contain `<`/`>`. Shared by the legacy
 * mount-normalization branch and the non-legacy prefix-splice path so both
 * locate the head-open token identically. */
const HEAD_OPEN_TAG = /<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i;

/**
 * Length-preserving mask of the CONTENT of every COMPLETE `<style>`/`<script>`
 * block and `<!-- … -->` comment (and the quoted attribute values inside those
 * style/script open tags) with spaces. Used by the NON-LEGACY path of
 * {@link assembleDocument} so a `<head>`/`</head>` token that appears INSIDE a
 * comment or inside style/script content BEFORE the real `<head>` cannot capture
 * the importmap/kit prefix splice (which would render the libraries and design
 * tokens inert). Indices map 1:1 to the original, so the prefix is spliced on the
 * ORIGINAL string at the masked match positions. A single left-to-right pass
 * masks whichever construct opens first, so the constructs never interfere.
 *
 * NOTE: this is intentionally NOT used by the legacy path, which is
 * byte-identity-locked to the historical `ensureHead`/`injectCssIntoHtml`
 * composition (a `</head>` lookalike inside a comment there is a pre-existing
 * quirk the byte-identity tests pin).
 */
function maskInertSpans(html: string): string {
  const blockRe = /<style\b|<script\b|<!--/gi;
  let out = "";
  let last = 0;
  blockRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const start = match.index;
    if (start < last) continue;
    const token = match[0];
    if (token === "<!--") {
      const close = html.indexOf("-->", start + 4);
      const contentStart = start + 4;
      const contentEnd = close === -1 ? html.length : close;
      out += html.slice(last, contentStart);
      out += " ".repeat(contentEnd - contentStart);
      last = contentEnd;
      blockRe.lastIndex = close === -1 ? html.length : close + 3;
    } else {
      const tagName = token.slice(1);
      const openEndMatch = html.slice(start).match(ASSEMBLE_OPEN_TAG_END);
      const openEnd = openEndMatch
        ? start + openEndMatch[0].length
        : html.length;
      const closeRe = new RegExp(`</${tagName}>`, "i");
      const closeRel = openEndMatch ? html.slice(openEnd).search(closeRe) : -1;
      const contentEnd = closeRel === -1 ? html.length : openEnd + closeRel;
      out += html.slice(last, start);
      out += html
        .slice(start, openEnd)
        .replace(
          /"[^"]*"|'[^']*'/g,
          (q) => q[0] + " ".repeat(q.length - 2) + q[0],
        );
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
 * Assembles a complete document string suitable for mounting in a sandbox iframe.
 *
 * Injection order (cascade invariant):
 * 1. `<script type="importmap">` — must precede any module script
 * 2. `<style data-ck-design-system>` — the design-system token/SVG/form kit
 * 3. …whatever `<head>` content the agent authored…
 * 4. `<style>` containing `opts.css` — agent-authored CSS, immediately before
 *    `</head>` so it wins over the kit on specificity ties
 *
 * Backward-compat invariant (legacy path): when no prefix is injected — i.e.
 * `designSystemCss` is falsy AND `importMap` is falsy or an empty object — the
 * legacy output L is computed verbatim as `ensureHead(css ? injectCssIntoHtml(
 * html, css) : html)` (the CSS injected into the raw html *before* ensuring
 * head). The contract is then:
 * - If L ALREADY contains the literal 6-character lowercase token `<head>`,
 *   return L UNCHANGED — byte-identical to the historical path. EVERY input that
 *   previously mounted in `@jetbrains/websandbox` lands here, because mounting
 *   itself requires that literal token (see the literal-`<head>` note below).
 * - Otherwise L has only an uppercase/attributed head-open tag (`<HEAD>`,
 *   `<head lang="en">`, `<head >`) and so contains no literal `<head>`. Such an
 *   artifact ALWAYS failed to mount before (no previously-working output reaches
 *   this branch). L is MOUNT-NORMALIZED: the first head-open token (located with
 *   the same quote-aware matcher the non-legacy path uses) is rewritten to the
 *   literal `<head>` so websandbox's `includes('<head>')` mount gate passes. If
 *   no head-open token matches at all (e.g. an unterminated `<head\t` tail), a
 *   minimal `<head></head>` is prepended (mirroring `ensureHead`'s no-head shape).
 *   The kit/importmap are intentionally NOT injected here — this is still the
 *   disabled path; only the head token is made mount-safe.
 *
 * Remaining legacy quirks are RETAINED BY DESIGN — they fire only on inputs whose
 * legacy output already contains the literal `<head>`, so those inputs stay
 * byte-identical: (a) the stray-`</head>` css splice — agent css spliced at a
 * `</head>` that precedes the real `<head>` (e.g. `foo</head>bar` + css → the css
 * lands at that stray close); (b) the duplicate-head emission for an unclosed
 * `<head>` carrying css (`<head><body>…` + css → `<head><style>…</style></head>`
 * is prepended ahead of the original unclosed `<head>`).
 *
 * Mask-before-match (NON-LEGACY path only): the head-open match and the agent-css
 * `</head>` close search both run on a length-preserving MASKED copy
 * ({@link maskInertSpans}) where the content of complete comments and
 * style/script blocks is blanked. A `<head>`/`</head>` token that appears inside
 * a comment (`<!-- build the <head> here -->`) or inside style/script content
 * BEFORE the real head therefore cannot capture the importmap/kit prefix splice
 * (which would render the libraries and design tokens inert inside that comment).
 * The legacy path is intentionally NOT masked — it is byte-identity-locked to the
 * historical composition, where a `</head>` lookalike is a pinned quirk.
 *
 * Literal-`<head>` normalization (NON-LEGACY path only): `@jetbrains/websandbox`
 * requires the exact 6-character lowercase token `<head>` in `frameContent` — it
 * throws `'Websandbox: iFrame content must have "<head>" tag.'` when
 * `!frameContent.includes('<head>')` (case-sensitive) and its bootstrap injects
 * via an exact `replace('<head>', '<head>\n<script>…')`
 * (see websandbox.js:450/462). An LLM-emitted document whose head-opening tag is
 * attributed or uppercase (`<head lang="en">`, `<HEAD>`, `<head >`) would
 * therefore fail to mount (stuck behind the loading spinner). So when the
 * quote-aware head-open matcher lands on a token that is NOT exactly `<head>`,
 * this path REPLACES that token with the literal `<head>` while splicing the
 * prefix. Head attributes (`lang`, `profile`, …) have negligible runtime
 * semantics and CANNOT be preserved: websandbox demands the exact `<head>`
 * token, so the matched token's attributes are intentionally dropped. The legacy
 * branch is byte-identity-locked and is NOT touched (this failure pre-existed
 * there).
 *
 * Pure string function — no DOM, no React.
 */
export function assembleDocument(
  html: string,
  opts: AssembleDocumentOptions = {},
): string {
  const { css, designSystemCss, importMap } = opts;

  // Build the prefix to insert immediately after the opening <head…> tag.
  // An empty importMap object ({}) is treated as no importmap — it would
  // otherwise emit an inert `<script type="importmap">{"imports":{}}</script>`.
  const hasImports = !!importMap && Object.keys(importMap).length > 0;
  const importMapPart = hasImports ? buildImportMapScript(importMap) : "";
  const designSystemPart = designSystemCss
    ? `<style data-ck-design-system>${designSystemCss}</style>`
    : "";
  const prefix = importMapPart + designSystemPart;

  // Non-legacy mode means "a prefix was actually injected". An empty importMap
  // ({}) with no design-system CSS produces an empty prefix and therefore stays
  // on the pure-legacy path — `importMap: {}` behaves exactly like `importMap:
  // false`. (Equivalent to `Boolean(designSystemCss) || hasImports`.)
  const nonLegacy = prefix !== "";

  // PURE LEGACY PATH — no prefix to inject. Reproduce the legacy composition
  // verbatim: inject the agent CSS into the RAW html first (the legacy
  // injectCssIntoHtml algorithm), THEN ensure a <head> exists (legacy
  // ensureHead). Applying the two helpers in this order yields the legacy output
  // L for ALL inputs by construction — including degenerate inputs where
  // `</head>` appears before/without an opening `<head>` (ensuring head first
  // would otherwise inject a spurious earlier `</head>` and the CSS would land in
  // the wrong place).
  if (!nonLegacy) {
    let legacy: string;
    if (css) {
      const headCloseIdx = html.indexOf("</head>");
      const injected =
        headCloseIdx !== -1
          ? html.slice(0, headCloseIdx) +
            `<style>${css}</style>` +
            html.slice(headCloseIdx)
          : `<head><style>${css}</style></head>${html}`;
      legacy = ensureHead(injected);
    } else {
      legacy = ensureHead(html);
    }

    // Carve-out (mount safety): if L already contains the exact 6-char literal
    // `<head>`, return it UNCHANGED — every input that previously mounted lands
    // here and stays byte-identical. Otherwise L has only an uppercase/attributed
    // head-open tag and so could never mount in `@jetbrains/websandbox`
    // (`includes('<head>')` gate, websandbox.js:450); normalize that token to the
    // literal `<head>` so the artifact mounts. The kit/importmap are NOT injected
    // — this is still the disabled path; only the head token is made mount-safe.
    if (legacy.includes("<head>")) return legacy;
    const headOpen = legacy.match(HEAD_OPEN_TAG);
    if (headOpen && headOpen.index !== undefined) {
      // Rewrite ONLY the first head-open token to the literal `<head>`; the css
      // placement (and everything else) is otherwise unchanged from L.
      return (
        legacy.slice(0, headOpen.index) +
        "<head>" +
        legacy.slice(headOpen.index + headOpen[0].length)
      );
    }
    // No head-open token matched at all (e.g. an unterminated `<head\t` tail that
    // `ensureHead` saw via `/<head[\s>]/` and declined to prepend). Prepend a
    // minimal websandbox-safe head, mirroring ensureHead's no-head shape — still
    // WITHOUT the kit/importmap.
    return `<head></head>${legacy}`;
  }

  // ASSEMBLED (NON-LEGACY) PATH — a prefix exists. Ensure a <head> first so the
  // prefix has a real head-opening tag to anchor to, then inject prefix +
  // agent css, preserving the documented cascade: importmap -> kit -> agent css.
  html = ensureHead(html);

  // Track where the prefix's opening <head…> tag ends so the css fallback can
  // inject immediately after the prefix instead of prepending a second head.
  let prefixInsertAt: number | undefined;

  // Match only a real head-opening tag: `<head>`, or `<head` followed by
  // whitespace + attributes. This deliberately excludes `<header …>`, which the
  // looser `/<head[^>]*>/i` would have captured (injecting into the body).
  // The attribute span is quote-aware: unquoted runs forbid `<`/`>` (so the tag
  // can never greedily swallow a following `<tag>` — e.g. `<head\t<body>` does
  // not match as one opening tag and splice the prefix into the body), while
  // quoted runs (`"…"` / `'…'`) may contain `<`/`>` so a realistic
  // `<head data-config='{"a":">"}'>` is matched whole rather than truncated at
  // the first quoted `>` (which would splice the prefix mid-attribute).
  //
  // Run the match on a MASKED copy (comment + style/script content blanked) so a
  // `<head>` token that appears INSIDE a comment or style/script content BEFORE
  // the real `<head>` does not capture the prefix splice (which would render the
  // importmap/kit inert inside that comment). Indices align 1:1, so the prefix is
  // spliced on the ORIGINAL `html` at the masked match index.
  const masked = maskInertSpans(html);
  const headOpenMatch = masked.match(HEAD_OPEN_TAG);
  if (headOpenMatch && headOpenMatch.index !== undefined) {
    const matchIdx = headOpenMatch.index;
    const matchedToken = headOpenMatch[0];
    // websandbox requires the exact 6-char literal `<head>` (see JSDoc above):
    // it `.includes('<head>')`-gates mounting and `.replace('<head>', …)`s to
    // inject its bootstrap. If the matched open token is anything else
    // (`<head lang="en">`, `<HEAD>`, `<head >`), REPLACE it with the literal
    // `<head>` while splicing the prefix — the token's attributes are dropped
    // (they have negligible runtime semantics and cannot be preserved). When
    // the token is already exactly `<head>`, `headOpen.length === 6 ===
    // matchedToken.length`, so this reduces to a verbatim splice-after-token.
    const headOpen = "<head>";
    // Anchor all offsets to the POST-replacement string: the rewritten region
    // is `headOpen + prefix + <original content after the matched token>`, so
    // the insertion point sits just past the prefix (start of the original head
    // content), preserving the cascade for the css fallback below.
    prefixInsertAt = matchIdx + headOpen.length + prefix.length;
    html =
      html.slice(0, matchIdx) +
      headOpen +
      prefix +
      html.slice(matchIdx + matchedToken.length);
  } else {
    // No real head-opening tag exists that we can anchor to (e.g. an
    // unterminated `<head \nclass=x` token that `ensureHead` saw via
    // `/<head[\s>]/` and therefore declined to prepend). Synthesize a head at
    // position 0 carrying the prefix — and, in cascade order, the agent css —
    // so the prefix is NEVER dropped. We return immediately: the css here is
    // already injected, so the css branch below must not run for this path.
    return `<head>${prefix}${css ? `<style>${css}</style>` : ""}</head>` + html;
  }

  // Inject agent CSS immediately before </head> (legacy algorithm), but match
  // the close tag case-insensitively here so it pairs with the case-insensitive
  // open-tag match above. A case-sensitive `indexOf("</head>")` would miss an
  // uppercase `</HEAD>`, dropping the css after the kit (via the prefixInsertAt
  // fallback) and inverting the cascade — the agent css must win over existing
  // head content. (The LEGACY branch keeps the exact `indexOf` for byte
  // identity; this case-insensitive lookup is non-legacy only.)
  //
  // Scope the close-tag search to the region AT/AFTER the prefix insertion
  // point so it pairs with the SAME head the open-tag matcher anchored to. A
  // global first-match search would resolve to a stray `</head>` that precedes
  // the real `<head>` (e.g. `foo</head><head>…</head>` or `</head><head></head>`)
  // — splicing the agent css before the importmap/kit and outside the real
  // head, inverting the documented cascade. Searching the slice from
  // `prefixInsertAt` (just past the injected prefix) and adding the offset back
  // guarantees the css lands inside the anchored head; if no close exists
  // at/after the anchor we fall through to the post-prefix fallback below
  // (never to an earlier global match).
  //
  // Search on a freshly MASKED copy of the spliced html so a `</head>` token
  // inside a comment or style/script content (after the prefix) cannot be
  // mistaken for the real close tag — the css would otherwise land inside that
  // inert region. The injected prefix's own `<script type="importmap">`/`<style>`
  // content is masked too (it carries no `</head>`), so this is safe.
  if (css) {
    const maskedAfter = maskInertSpans(html);
    const closeRel = maskedAfter.slice(prefixInsertAt).search(/<\/head>/i);
    const headCloseIdx = closeRel !== -1 ? closeRel + prefixInsertAt : -1;
    if (headCloseIdx !== -1) {
      return (
        html.slice(0, headCloseIdx) +
        `<style>${css}</style>` +
        html.slice(headCloseIdx)
      );
    }
    // No </head> exists. ensureHead guarantees a real head-opening tag is
    // present, so inject the agent css right after the kit/importmap prefix —
    // keeping the documented cascade (kit first, agent css after) and avoiding
    // a duplicate <head>.
    if (prefixInsertAt !== undefined) {
      return (
        html.slice(0, prefixInsertAt) +
        `<style>${css}</style>` +
        html.slice(prefixInsertAt)
      );
    }
    return `<head><style>${css}</style></head>${html}`;
  }

  return html;
}
