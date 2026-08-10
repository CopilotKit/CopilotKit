// Fails if a React-Native-reachable chunk references the chat-message rendering
// stack. @copilotkit/react-native imports two react-core entries — /v2/headless
// and /v2/context — and neither may drag the ~5.5 MB shiki grammars/themes plus
// mermaid, cytoscape and katex (issue #4893). This script guards both built
// entries: the /v2/headless entry exists so consumers with a custom UI can import
// hooks without that weight, and /v2/context carries CopilotKitCoreReact, so its
// transitive subtree must stay clean too. (The RN import-graph guard in
// packages/react-native/src/__tests__/headless-entry-surface.test.ts allows these
// same two entries but only walks that package's own source; this script walks
// the built graph, so it follows relative chunk edges and into node_modules.)
//
// This is a STRUCTURAL assertion, not a size budget: it names the specific
// regression instead of guarding a byte threshold, so it hard-fails legitimately
// and needs no baseline maintenance. Size *budgets* remain blocked on OSS-122 —
// see dev-docs/bundle-size.md.
//
// ─── Why it drives esbuild instead of grepping the entry files ───────────────
// The first version read the four entry files and asked `code.includes(dep)`.
// That was weaker than it claimed, in both directions, and every item below was
// reproduced against a real build before this rewrite:
//
//  1. It only inspected those four files, so any violation reached through an
//     edge OUT of them was invisible. Proven: re-exporting one hook from the fat
//     `@copilotkit/react-core/v2` entry (which links the whole render stack) left
//     `dist/v2/headless.mjs` with an unresolved bare import of that entry — and
//     the guard printed "clean" for all four files. Same for a heavy dep reached
//     through `@copilotkit/core`, which is external to this build: the entry says
//     only `from "@copilotkit/core"`, and grepping that string finds nothing.
//     A split-out chunk (`import "./chunk-abc.mjs"`) escaped the same way.
//  2. The header used to claim the check "follows into node_modules". It did not
//     follow anything — not node_modules, not even a relative sibling chunk.
//  3. `code.includes(dep)` is unanchored, so it matched comments, strings and
//     identifiers. Not hypothetical: the five banned tokens sit in
//     `src/v2/headless.ts`'s own file banner, and the built artifact IS
//     comment-preserving (233 lines of block comments survive in
//     dist/v2/headless.mjs). They are absent only because that module is a
//     re-export shell whose banner attaches to no retained code. Moving the same
//     sentence into any module that ships code hard-failed CI on all five tokens
//     while linking none of them.
//
// So the graph — not the text — is the thing to assert. esbuild bundles each
// built entry with `metafile: true` and reports every file it had to load;
// forbidden-dep matching runs on those resolved paths, never on file contents,
// which is why this guard cannot be fooled (or tripped) by a comment. It resolves
// package `exports` maps, subpaths, extensions and pnpm symlinks itself, and an
// edge it cannot resolve is an esbuild *error*, which this script reports as a
// failure rather than as silence (fail loud: an unresolvable edge hides a whole
// subgraph).
//
// One edge shape stays invisible even to a bundler: `import(name)` /
// `require(name)` with a non-literal argument. esbuild leaves those alone and (for
// ESM `import()`) does not even warn, so the graph would look clean while a fat
// entry hid behind a variable. The one place this script therefore reads text is
// to find those calls in the graph's FIRST-PARTY files (our own and our workspace
// siblings' built output — third-party dynamic requires are endemic and say
// nothing about #4893), and it strips comments before looking, so a documented
// counter-example cannot trip it.
//
// esbuild is already this package's devDependency and already runs in the same CI
// job (scripts/measure-copilotchat.mjs), and react/react-dom stay external there
// for the same reason as here: a host app ships them, they cannot reach the
// render stack, and bundling them buries the signal in thousands of inputs.
//
// Covered by scripts/__tests__/assert-headless-purity.test.mjs (`test:scripts`).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { build } from "esbuild";

const FORBIDDEN = ["shiki", "mermaid", "cytoscape", "katex", "streamdown"];
const dist = path.resolve(import.meta.dirname, "../dist/v2");
const targets = ["headless.mjs", "headless.cjs", "context.mjs", "context.cjs"];

// A host React app already ships these, and none of them can reach the render
// stack. Mirrors scripts/measure-copilotchat.mjs.
const DEFAULT_EXTERNAL = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom/server",
];

// We measure the JS graph, not CSS. Stubbing these keeps a `katex/dist/*.css`
// style import from crashing the bundle while STILL recording it as a graph
// input (the loader runs after resolution), so a CSS-only leak is still caught.
const EMPTY_LOADERS = {
  ".css": "empty",
  ".woff": "empty",
  ".woff2": "empty",
  ".ttf": "empty",
  ".eot": "empty",
  ".svg": "empty",
};

// esbuild warnings that mean "I could not see through this edge". Silence here
// is exactly how a lazily-required fat entry would hide, so they fail the guard
// instead of being logged. Anything else esbuild warns about is printed but not
// fatal — third-party code warns for reasons that say nothing about #4893.
const GRAPH_BLINDING_WARNINGS = [
  /will not be bundled/i,
  /could not be resolved/i,
];

/**
 * Comment / string / template alternation, scanned left-to-right in ONE pass.
 *
 * Ported verbatim from the sibling guard in
 * packages/react-native/src/__tests__/headless-entry-surface.test.ts, which hit
 * the same class of bug. Matching strings with the SAME alternation is what makes
 * comment stripping correct: a `//` inside a string literal is consumed as part of
 * the string before the comment branch can see it, and a quote inside a comment is
 * consumed as part of the comment. `'` and `"` deliberately do not cross a
 * newline, so an unbalanced apostrophe in prose ("doesn't") cannot swallow the
 * rest of a file.
 */
const COMMENT_OR_LITERAL =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Every way a module can pull another one in at runtime. */
const LOADER_CALL = /\b(?:import|require(?:\.resolve)?)\s*\(\s*/g;

/**
 * Blanks out comments, preserving newlines (and therefore line numbers) and
 * leaving real string/template literals untouched.
 *
 * @param {string} code
 * @returns {string}
 */
export function stripComments(code) {
  return code.replace(COMMENT_OR_LITERAL, (match) =>
    match.startsWith("//") || match.startsWith("/*")
      ? match.replace(/[^\n]/g, " ")
      : match,
  );
}

/**
 * Loader calls whose argument is not a string literal, and which therefore hide
 * whatever they load from any static analysis — including a bundler's.
 *
 * @param {string} code
 * @returns {string[]} A short excerpt per unanalyzable call.
 */
export function unanalyzableLoaderCalls(code) {
  const stripped = stripComments(code);
  const found = [];
  for (const match of stripped.matchAll(LOADER_CALL)) {
    const after = stripped.slice(match.index + match[0].length);
    if (/^["'`]/.test(after)) continue;
    found.push(
      stripped
        .slice(match.index, match.index + match[0].length + 48)
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return found;
}

/**
 * The npm package a resolved graph input belongs to, or null for first-party
 * files. Uses the LAST `node_modules/` segment so pnpm's
 * `node_modules/.pnpm/zod@3.25.76/node_modules/zod/lib/index.mjs` yields `zod`
 * rather than `.pnpm`.
 *
 * @param {string} inputPath
 * @returns {string | null}
 */
export function packageNameFor(inputPath) {
  const parts = inputPath.split("node_modules/");
  if (parts.length < 2) return null;
  const segments = parts[parts.length - 1].split("/");
  if (segments[0].startsWith("@")) {
    return segments.length > 1 ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0] || null;
}

/**
 * Whether a package name belongs to a forbidden dependency's family.
 *
 * Anchored at the START of the package NAME (never mid-string, and never over
 * file contents), so it catches the family a dep ships as — `@shikijs/langs`,
 * `cytoscape-fcose` — without matching an unrelated file that merely mentions
 * the word.
 *
 * @param {string} packageName
 * @param {string} dep
 * @returns {boolean}
 */
export function isForbiddenPackage(packageName, dep) {
  return (
    packageName === dep ||
    packageName.startsWith(`${dep}/`) ||
    packageName.startsWith(`${dep}-`) ||
    packageName.startsWith(`@${dep}`)
  );
}

/**
 * Match a resolved module graph against the forbidden list.
 *
 * @param {object} options
 * @param {string[]} options.inputs - Resolved graph input paths (esbuild metafile keys).
 * @param {string[]} [options.externalSpecifiers] - Bare specifiers left external, which resolve to no input.
 * @param {string[]} options.forbidden - Dependency names that must not appear.
 * @returns {{ dep: string, via: string[] }[]} One entry per forbidden dep that is present.
 */
export function forbiddenHits({ inputs, externalSpecifiers = [], forbidden }) {
  const names = new Set();
  for (const input of inputs) {
    const name = packageNameFor(input);
    if (name) names.add(name);
  }
  // An external specifier never becomes an input, so it would otherwise be a
  // blind spot in exactly the direction that already bit this guard once.
  for (const specifier of externalSpecifiers) {
    if (specifier.startsWith(".") || path.isAbsolute(specifier)) continue;
    const segments = specifier.split("/");
    names.add(
      segments[0].startsWith("@") && segments.length > 1
        ? `${segments[0]}/${segments[1]}`
        : segments[0],
    );
  }
  const hits = [];
  for (const dep of forbidden) {
    const via = [...names].filter((name) => isForbiddenPackage(name, dep));
    if (via.length) hits.push({ dep, via: via.sort() });
  }
  return hits;
}

/**
 * Bundle one built entry with esbuild and return everything it had to load.
 *
 * Throws (loudly, with esbuild's own text) when an edge cannot be resolved: a
 * dropped edge hides a whole subgraph, so it must never read as clean.
 *
 * @param {object} options
 * @param {string} options.entryFile - Path to a built entry (.mjs or .cjs).
 * @param {string} options.pkgRoot - Working directory for esbuild resolution.
 * @param {string[]} [options.external]
 * @param {Record<string, string>} [options.loader]
 * @returns {Promise<{ inputs: string[], externalSpecifiers: string[], blindingWarnings: string[], otherWarnings: string[] }>}
 */
export async function collectModuleGraph({
  entryFile,
  pkgRoot,
  external = DEFAULT_EXTERNAL,
  loader = EMPTY_LOADERS,
}) {
  let result;
  try {
    result = await build({
      entryPoints: [entryFile],
      absWorkingDir: pkgRoot,
      bundle: true,
      write: false,
      metafile: true,
      format: entryFile.endsWith(".cjs") ? "cjs" : "esm",
      platform: "browser",
      target: "es2022",
      external,
      loader,
      logLevel: "silent",
    });
  } catch (error) {
    const texts = (error.errors ?? []).map((e) => e.text);
    throw new Error(
      `could not resolve the module graph of ${path.basename(entryFile)} — ` +
        `an unresolvable edge hides everything behind it, so this is a failure, ` +
        `not a pass:\n  ${texts.length ? texts.join("\n  ") : String(error.message ?? error)}`,
      { cause: error },
    );
  }

  const inputs = Object.keys(result.metafile.inputs);
  // A graph that does not even contain its own entry means we measured nothing.
  const entryKey = path.relative(pkgRoot, path.resolve(pkgRoot, entryFile));
  if (!inputs.includes(entryKey) && !inputs.includes(entryFile)) {
    throw new Error(
      `the module graph of ${path.basename(entryFile)} does not contain the entry ` +
        `itself (${entryKey}) — the scan measured nothing`,
    );
  }

  const externalSpecifiers = new Set();
  for (const input of Object.values(result.metafile.inputs)) {
    for (const edge of input.imports ?? []) {
      if (edge.external) externalSpecifiers.add(edge.path);
    }
  }

  const warnings = (result.warnings ?? []).map((w) => w.text);
  return {
    inputs,
    externalSpecifiers: [...externalSpecifiers],
    blindingWarnings: warnings.filter((text) =>
      GRAPH_BLINDING_WARNINGS.some((pattern) => pattern.test(text)),
    ),
    otherWarnings: warnings.filter(
      (text) => !GRAPH_BLINDING_WARNINGS.some((pattern) => pattern.test(text)),
    ),
  };
}

/**
 * Every unanalyzable loader call in the graph's first-party files, i.e. the ones
 * a bundler cannot see through. Third-party files are skipped on purpose: their
 * dynamic requires are endemic and say nothing about #4893.
 *
 * A first-party input that is not readable is itself reported — silence about a
 * file we were supposed to check is the failure mode this guard shipped with.
 *
 * @param {object} options
 * @param {string[]} options.inputs
 * @param {string} options.pkgRoot
 * @returns {string[]}
 */
export function unanalyzableEdgesIn({ inputs, pkgRoot }) {
  const found = [];
  for (const input of inputs) {
    if (input.includes("node_modules")) continue;
    const absolute = path.resolve(pkgRoot, input);
    if (!fs.existsSync(absolute)) {
      found.push(`${input} — in the graph but not readable on disk`);
      continue;
    }
    for (const call of unanalyzableLoaderCalls(
      fs.readFileSync(absolute, "utf8"),
    )) {
      found.push(`${input} — ${call}`);
    }
  }
  return found;
}

/**
 * Walk one built entry's graph and report forbidden dependencies in it.
 *
 * @param {object} options
 * @param {string} options.entryFile
 * @param {string} options.pkgRoot
 * @param {string[]} options.forbidden
 * @returns {Promise<{ hits: { dep: string, via: string[] }[], inputCount: number, unanalyzable: string[], blindingWarnings: string[], otherWarnings: string[] }>}
 */
export async function assertEntryPurity({ entryFile, pkgRoot, forbidden }) {
  const { inputs, externalSpecifiers, blindingWarnings, otherWarnings } =
    await collectModuleGraph({ entryFile, pkgRoot });
  return {
    hits: forbiddenHits({ inputs, externalSpecifiers, forbidden }),
    inputCount: inputs.length,
    unanalyzable: unanalyzableEdgesIn({ inputs, pkgRoot }),
    blindingWarnings,
    otherWarnings,
  };
}

// CLI entry — only runs when invoked directly, so importing this module from
// tests does not walk the real dist graph at module-load time.
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`;

if (isMain) {
  const pkgRoot = path.resolve(dist, "../..");
  let failed = false;

  for (const file of targets) {
    const full = path.join(dist, file);
    if (!fs.existsSync(full)) {
      console.error(
        `✗ ${file} not found — run \`nx run @copilotkit/react-core:build\` first`,
      );
      failed = true;
      continue;
    }

    let report;
    try {
      report = await assertEntryPurity({
        entryFile: full,
        pkgRoot,
        forbidden: FORBIDDEN,
      });
    } catch (error) {
      console.error(`✗ ${file}: ${error.message}`);
      failed = true;
      continue;
    }

    for (const text of report.otherWarnings) {
      console.warn(`  (esbuild warning, not fatal) ${file}: ${text}`);
    }
    const opaque = [...report.blindingWarnings, ...report.unanalyzable];
    if (opaque.length) {
      console.error(
        `✗ ${file} has edges this scan cannot follow, so it cannot be called clean:\n  ` +
          opaque.join("\n  "),
      );
      failed = true;
      continue;
    }
    if (report.hits.length) {
      const detail = report.hits
        .map(({ dep, via }) =>
          via.length === 1 && via[0] === dep
            ? dep
            : `${dep} (via ${via.join(", ")})`,
        )
        .join(", ");
      console.error(
        `✗ ${file} links the heavy render stack: ${detail}\n` +
          `  (${report.inputCount} modules in its graph)`,
      );
      failed = true;
      continue;
    }
    console.log(
      `✓ ${file} (${fs.statSync(full).size} B, ${report.inputCount} modules in graph) — clean`,
    );
  }

  if (failed) {
    console.error(
      "\nThe React-Native-reachable entries (/v2/headless, /v2/context) must not link\n" +
        "the chat-message rendering stack (#4893).\n" +
        "If a hook you added needs it, it belongs in the main /v2 entry instead.",
    );
    process.exit(1);
  }
}
