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
 */
export function buildImportMapScript(libs: Record<string, string>): string {
  return `<script type="importmap">${JSON.stringify({ imports: libs })}</script>`;
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
 * Backward-compat invariant: when no prefix is injected — i.e. `designSystemCss`
 * is falsy AND `importMap` is falsy or an empty object — the output is
 * byte-identical to the legacy `ensureHead(css ? injectCssIntoHtml(html, css)
 * : html)` path for ALL inputs, by construction (the legacy composition is
 * reproduced verbatim, injecting CSS into the raw html *before* ensuring head).
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
  // ensureHead). Applying the two helpers in this order makes the output
  // byte-identical to the legacy path for ALL inputs by construction —
  // including degenerate inputs where `</head>` appears before/without an
  // opening `<head>` (ensuring head first would otherwise inject a spurious
  // earlier `</head>` and the CSS would land in the wrong place).
  if (!nonLegacy) {
    if (css) {
      const headCloseIdx = html.indexOf("</head>");
      const injected =
        headCloseIdx !== -1
          ? html.slice(0, headCloseIdx) +
            `<style>${css}</style>` +
            html.slice(headCloseIdx)
          : `<head><style>${css}</style></head>${html}`;
      return ensureHead(injected);
    }
    return ensureHead(html);
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
  const headOpenMatch = html.match(/<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i);
  if (headOpenMatch && headOpenMatch.index !== undefined) {
    prefixInsertAt = headOpenMatch.index + headOpenMatch[0].length;
    html = html.slice(0, prefixInsertAt) + prefix + html.slice(prefixInsertAt);
    // The inserted prefix shifts the insertion point past its own bytes so
    // the css fallback lands after the prefix (kit), preserving the cascade.
    prefixInsertAt += prefix.length;
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
  if (css) {
    const headCloseIdx = html.search(/<\/head>/i);
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
