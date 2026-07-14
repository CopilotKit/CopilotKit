/**
 * Turbopack loader: strip explicit `.js` extensions off RELATIVE import/export
 * specifiers so they resolve to their `.ts`/`.tsx` sources.
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
 * next.config.ts). Turbopack has NO equivalent — mapping a relative `.js`
 * specifier to its `.ts` source is an open, unimplemented feature request
 * (vercel/next.js#82945; `turbopack.resolveAlias`/`resolveExtensions` do not
 * match relative specifiers). Until Turbopack ships parity, the documented
 * community workaround is a transform loader that drops the trailing `.js`
 * from relative specifiers, letting Turbopack's normal extension resolution
 * (`.ts`/`.tsx`/`.js`) take over.
 *
 * The `next.config.ts` rule scopes this loader to the fold sources ONLY, so
 * no other dashboard module is rewritten. The fold's on-disk `.js` specifiers
 * are left untouched — they remain correct for the harness's Node-ESM runtime.
 */
module.exports = function stripRelativeJsExtensions(source) {
  // Match `from "./x.js"` / `from '../y/z.js'` (import + re-export forms) and
  // `import("./x.js")` dynamic imports, but only RELATIVE specifiers
  // (starting with `.`), never bare/package specifiers.
  return source
    .replace(/(from\s+["'])(\.[^"']*?)\.js(["'])/g, "$1$2$3")
    .replace(/(import\(\s*["'])(\.[^"']*?)\.js(["']\s*\))/g, "$1$2$3");
};
