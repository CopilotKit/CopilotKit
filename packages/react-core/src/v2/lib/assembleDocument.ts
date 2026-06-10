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
 * Backward-compat invariant: when both `designSystemCss` and `importMap` are
 * falsy, the output is byte-identical to the legacy
 * `ensureHead(css ? injectCssIntoHtml(html, css) : html)` path.
 *
 * Pure string function — no DOM, no React.
 */
export function assembleDocument(
  html: string,
  opts: AssembleDocumentOptions = {},
): string {
  const { css, designSystemCss, importMap } = opts;

  // Step 1: ensure a <head> tag exists.
  html = ensureHead(html);

  // Step 2: build the prefix to insert immediately after the opening <head…> tag.
  const importMapPart = importMap ? buildImportMapScript(importMap) : "";
  const designSystemPart = designSystemCss
    ? `<style data-ck-design-system>${designSystemCss}</style>`
    : "";
  const prefix = importMapPart + designSystemPart;

  if (prefix) {
    // Insert right after the first <head…> opening tag.
    const headOpenMatch = html.match(/<head[^>]*>/i);
    if (headOpenMatch && headOpenMatch.index !== undefined) {
      const insertAt = headOpenMatch.index + headOpenMatch[0].length;
      html = html.slice(0, insertAt) + prefix + html.slice(insertAt);
    }
  }

  // Step 3: inject agent CSS immediately before </head> (legacy algorithm).
  if (css) {
    const headCloseIdx = html.indexOf("</head>");
    if (headCloseIdx !== -1) {
      return (
        html.slice(0, headCloseIdx) +
        `<style>${css}</style>` +
        html.slice(headCloseIdx)
      );
    }
    return `<head><style>${css}</style></head>${html}`;
  }

  return html;
}
