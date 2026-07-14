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
 * SAFE MATCHING — MASK THEN MATCH (not a blanket text replace)
 * A naive `from "…".js` / `import("…").js` text replace mutates ANY occurrence
 * of that shape, INCLUDING ones that appear inside string literals, template
 * literals, and comments — e.g. a template `` `await import("./x.js")` `` or a
 * doc comment `// see ./x.js`. Line-anchoring alone is NOT enough: a multi-line
 * template literal can contain a physical line that begins with `from "./x.js"`,
 * and a dynamic-`import("…")` call shape occurs freely inside string data.
 *
 * To rewrite ONLY real code, this loader first builds a length-preserving
 * "masked" view of the source in which the interior of every comment
 * (`// …`, `/* … *\/`) and every string/template literal (`'…'`, `"…"`,
 * `` `…` ``) is blanked to spaces (newlines preserved so line/column offsets
 * are identical to the original). The specifier regexes run against the MASKED
 * view — so they can never match text that lived inside a comment or literal —
 * and the resulting match RANGES are applied back to the ORIGINAL source. Real
 * import/export specifiers are never inside a literal, so they survive masking
 * and are the only things rewritten. Only RELATIVE specifiers (starting with
 * `.`) are rewritten; bare/package specifiers (`"react.js"`, `"pkg/e.js"`) are
 * left untouched.
 *
 * The `next.config.ts` rule scopes this loader to the 4 fold module files ONLY
 * (cell-model / live-status / staleness / format-ts), excluding test and
 * equivalence-fixture siblings. The fold's on-disk `.js` specifiers are left
 * untouched on disk — they remain correct for the harness's Node-ESM runtime.
 *
 * SOURCEMAP: every edit is a pure deletion of the 2–3-char extension suffix
 * (`js`/`mjs`/`cjs`) from a single specifier token. The incoming map is
 * forwarded unchanged: line mappings stay exact, and only columns AFTER the
 * edited specifier on that one line shift left by the removed length — a
 * cosmetic offset limited to the tail of rewritten import lines. Forwarding the
 * map keeps whole-file line-level fold debugging intact (far better than
 * dropping it); we do not regenerate per-column mappings for the specifier tail.
 */

// A relative specifier + strippable extension. `EXT` lists the extensions
// webpack's extensionAlias maps (.js, .mjs, .cjs). `REL` is the relative path
// body (must start with `.`), non-greedy up to the closing quote.
const REL = `(\\.[^"'\\n]*?)`;
const EXT = `(?:js|mjs|cjs)`;

// Static import/export whose `from` clause is line-anchored — covers both the
// single-line form (`import { a } from "./a.js";`, `export * from "./a.js";`)
// and the multi-line form whose closing `} from "./a.js"` (or bare
// `from "./a.js"`) sits on its own line. Two variants: one keyed on a leading
// `import`/`export` keyword (single-line), one keyed on a line-leading `from` /
// `} from` (multi-line continuation). Both run against the MASKED view, so a
// line-leading `from` INSIDE a template literal is blanked and cannot match.
const STATIC_FROM_INLINE = new RegExp(
  `(^[ \\t]*(?:import|export)\\b[^"'\\n]*?\\bfrom[ \\t]+["'])${REL}\\.${EXT}(["'])`,
  "gm",
);
const STATIC_FROM_LINE = new RegExp(
  `(^[ \\t]*(?:\\}[ \\t]*)?from[ \\t]+["'])${REL}\\.${EXT}(["'])`,
  "gm",
);

// Bare side-effect import `import "./x.js";` (no `from` clause), line-anchored.
const BARE_IMPORT = new RegExp(
  `(^[ \\t]*import[ \\t]+["'])${REL}\\.${EXT}(["'])`,
  "gm",
);

// Dynamic `import("./x.js")`. Matched against the MASKED view, so an
// `import("…")` shape sitting inside a string/template/comment is blanked and
// cannot match — only a real dynamic import in code is rewritten.
const DYNAMIC_IMPORT = new RegExp(
  `(import\\([ \\t]*["'])${REL}\\.${EXT}(["'][ \\t]*\\))`,
  "g",
);

const PATTERNS = [
  STATIC_FROM_INLINE,
  STATIC_FROM_LINE,
  BARE_IMPORT,
  DYNAMIC_IMPORT,
];

/**
 * Build a length-preserving copy of `source` where the INTERIOR of every
 * comment and string/template literal is replaced with spaces (newlines kept,
 * so every index in the mask corresponds to the same index in `source`).
 * Quote/backtick/comment delimiters themselves are preserved so the specifier
 * regexes still see the surrounding `from "…"` / `import("…")` structure of
 * REAL code, while any `from "…"`/`import("…")`-shaped text that lived inside a
 * literal is destroyed. A simple single-pass scanner over the standard JS
 * lexical states — enough to protect the scoped fold files without a full
 * parser.
 */
function maskLiteralsAndComments(source) {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  // States: code | line-comment | block-comment | sq (') | dq (") | tpl (`)
  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : "";
    if (c === "/" && c2 === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      i += 2; // skip closing */
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++; // past opening delimiter (kept)
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          // escaped char inside the literal — blank both, skip.
          if (source[i] !== "\n") out[i] = " ";
          if (i + 1 < n && source[i + 1] !== "\n") out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++; // past closing delimiter (kept)
          break;
        }
        // Note: template `${…}` interpolations are blanked wholesale here. That
        // is safe for this loader — a real import/export can never live inside
        // an interpolation, so blanking it only removes potential false matches.
        if (ch !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

function stripRelativeJsExtensions(source, map) {
  // The mask is used ONLY as a code-vs-literal oracle: it blanks the interior
  // of every comment and string/template literal (delimiters kept). We match
  // the specifier regexes against the ORIGINAL source (so the specifier text
  // survives to be matched) and then keep a match only if its leading keyword
  // (`import`/`export`/`from`/`import(`) survived masking unchanged — i.e. it
  // is real code, not text that happened to sit inside a literal or comment.
  const masked = maskLiteralsAndComments(source);

  // Collect edits (index ranges of the `.<ext>` suffix to delete). Dedupe
  // overlapping matches (a specifier can match more than one pattern) by
  // keeping the first edit that covers each extension position.
  const edits = [];
  const seen = new Set();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      // Reject the match unless the keyword prefix (m[1] up to the opening
      // quote) is byte-for-byte identical in the mask — a real code statement.
      // If any prefix char was blanked, the `from`/`import(` shape lived inside
      // a comment or literal and must NOT be rewritten.
      const prefixInMask = masked.slice(m.index, m.index + m[1].length);
      if (prefixInMask !== m[1]) continue;

      // Layout: m[1]=prefix (…opening quote), m[2]=relative path body, then a
      // literal `.<ext>`, then m[3]=suffix (closing quote [+ `)` for dynamic]).
      // Delete exactly the `.<ext>` run.
      const extStart = m.index + m[1].length + m[2].length; // at the `.`
      const extEnd = m.index + m[0].length - m[3].length; // end of `.<ext>`
      const key = extStart + ":" + extEnd;
      if (seen.has(key)) continue;
      seen.add(key);
      edits.push([extStart, extEnd]);
    }
  }

  let out = source;
  if (edits.length > 0) {
    edits.sort((a, b) => a[0] - b[0]);
    let result = "";
    let cursor = 0;
    for (const [start, end] of edits) {
      if (start < cursor) continue; // skip any overlap
      result += source.slice(cursor, start);
      cursor = end; // drop [start,end) — the `.<ext>` suffix
    }
    result += source.slice(cursor);
    out = result;
  }

  // Forward the incoming sourcemap (see header note on the cosmetic column
  // offset). Prefer the webpack-style `this.callback(err, code, map)`; fall
  // back to a plain return when invoked without a loader context (unit tests).
  if (this && typeof this.callback === "function") {
    this.callback(null, out, map);
    return;
  }
  return out;
}

module.exports = stripRelativeJsExtensions;
module.exports.maskLiteralsAndComments = maskLiteralsAndComments;
