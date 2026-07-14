/**
 * Turbopack loader: strip explicit `.js`/`.mjs`/`.cjs` extensions off RELATIVE
 * import/export specifiers so they resolve to their `.ts`/`.tsx` sources.
 *
 * WHY THIS EXISTS
 * The dashboard re-exports the shared cell-model fold from the harness
 * (`src/lib/{cell-model,live-status,staleness,format-ts}.ts` →
 * `../../../harness/src/shared/cell-model/*`). Those fold files are authored
 * for the harness's pure-Node-ESM runtime, so their INTERNAL relative imports
 * carry explicit `.js` extensions (e.g. `import { formatTs } from
 * "./format-ts.js"`) while only `./format-ts.ts` exists on disk. `export *`
 * does not rewrite those internal edges.
 *
 * The webpack build fixes this with `resolve.extensionAlias` (see
 * next.config.ts), which maps `.js`→`.ts`/`.tsx`/`.js` AND `.mjs`→`.mts`/`.mjs`.
 * Turbopack has NO equivalent — mapping a relative `.js` specifier to its `.ts`
 * source is an open, unimplemented feature request (vercel/next.js#82945;
 * `turbopack.resolveAlias`/`resolveExtensions` do not match relative
 * specifiers). Until Turbopack ships parity, the documented community
 * workaround is a transform loader that drops the trailing extension from
 * relative specifiers, letting Turbopack's normal extension resolution
 * (`.ts`/`.tsx`/`.js`) take over.
 *
 * SAFE MATCHING (why this is not a blanket text replace)
 * A naive `from "…".js` text replace mutates ANY occurrence of that shape,
 * including inside string literals, comments, and template literals — e.g. a
 * template `` `import a from "./tpl.js"` `` would be corrupted. To avoid that
 * without shipping a full parser, matching is anchored to real import/export
 * STATEMENT context:
 *   - static/re-export forms are matched only when the `from` clause (or a
 *     leading `import`/`export` keyword, for single-line forms) begins a line
 *     — a `from "…"` at statement position, never `from` embedded mid-line in
 *     string data. This also covers multi-line `import { … } from "./x.js"`
 *     blocks, whose `from` clause sits on its own line.
 *   - bare side-effect imports `import "./x.js";` are matched line-anchored.
 *   - dynamic `import("./x.js")` is matched by its distinctive call syntax.
 * Only RELATIVE specifiers (starting with `.`) are ever rewritten; bare/package
 * specifiers (`"react.js"`, `"pkg/e.js"`) are left untouched.
 *
 * The `next.config.ts` rule scopes this loader to the 4 fold module files ONLY
 * (cell-model / live-status / staleness / format-ts), excluding test and
 * equivalence-fixture siblings. The fold's on-disk `.js` specifiers are left
 * untouched on disk — they remain correct for the harness's Node-ESM runtime.
 * The incoming sourcemap is forwarded so fold debugging keeps working.
 */

// A relative specifier + strippable extension, captured so the extension can
// be dropped while quotes/relative path are preserved. `EXT` lists the
// extensions webpack's extensionAlias maps (.js, .mjs, .cjs).
const REL = `(\\.[^"'\\n]*?)`; // relative path body (starts with `.`)
const EXT = `(?:js|mjs|cjs)`;

// Static import/export whose `from` clause is line-anchored. Covers the
// multi-line form whose closing `} from "./a.js"` (or a bare `from "./a.js"`)
// sits on its own line — the `from` keyword begins the trimmed line, optionally
// after a `}`. A `from "…"` embedded mid-line (e.g. inside a template literal)
// is NOT matched.
const STATIC_FROM_LINE = new RegExp(
  `(^[ \\t]*(?:\\}[ \\t]*)?from[ \\t]+["'])${REL}\\.${EXT}(["'])`,
  "gm",
);

// Single-line static import/export beginning with the keyword and carrying its
// `from "./x.js"` clause on the same line (`import { a } from "./a.js";`,
// `export * from "./a.js";`). Anchored to a leading `import`/`export` keyword so
// the `from` must belong to a real statement, not string/comment data. The
// `[^"'\n]*` gate keeps the match on a single logical line and prevents it from
// spanning an intervening string that could contain its own quotes.
const STATIC_FROM_INLINE = new RegExp(
  `(^[ \\t]*(?:import|export)\\b[^"'\\n]*?\\bfrom[ \\t]+["'])${REL}\\.${EXT}(["'])`,
  "gm",
);

// Bare side-effect import `import "./x.js";` (no `from` clause), line-anchored.
const BARE_IMPORT = new RegExp(
  `(^[ \\t]*import[ \\t]+["'])${REL}\\.${EXT}(["'])`,
  "gm",
);

// Dynamic `import("./x.js")` — matched by its call syntax, which cannot occur
// as incidental string data the way a bare `from "…"` shape can.
const DYNAMIC_IMPORT = new RegExp(
  `(import\\([ \\t]*["'])${REL}\\.${EXT}(["'][ \\t]*\\))`,
  "g",
);

function stripRelativeJsExtensions(source, map) {
  const out = source
    .replace(STATIC_FROM_INLINE, "$1$2$3")
    .replace(STATIC_FROM_LINE, "$1$2$3")
    .replace(BARE_IMPORT, "$1$2$3")
    .replace(DYNAMIC_IMPORT, "$1$2$3");

  // Forward the incoming sourcemap so fold debugging keeps working. Prefer the
  // webpack-style `this.callback(err, code, map)`; fall back to a plain return
  // when invoked without a loader context (e.g. unit tests calling directly).
  if (this && typeof this.callback === "function") {
    this.callback(null, out, map);
    return;
  }
  return out;
}

module.exports = stripRelativeJsExtensions;
