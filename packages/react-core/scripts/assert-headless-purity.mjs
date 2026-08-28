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
// nothing about #4893). That scan runs over a TOKENIZED view of the file in which
// comments, strings, templates and regexes are blanked (see `scanSource` below), so
// a documented counter-example — or any other import-shaped text — cannot trip it,
// and a `//` inside a regex cannot hide a real call. See the block comment above
// `scanSource` for the wrong verdicts the earlier regex pair produced in BOTH
// directions, and for what the tokenizer still does not cover.
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
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const FORBIDDEN = ["shiki", "mermaid", "cytoscape", "katex", "streamdown"];
// `fileURLToPath(import.meta.url)`, not `import.meta.dirname`: the latter landed
// in Node 20.11 and is `undefined` below it, which would turn this hard-fail gate
// into an opaque ERR_INVALID_ARG_TYPE for anyone on the `engines: ">=18"` floor
// the root package.json still declares. Same idiom as scripts/measure-copilotchat.mjs.
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/v2",
);
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

// ─── Why the text scan is a tokenizer and not an alternation of regexes ──────
// The previous version layered two regexes: one comment/string/template
// alternation to blank comments, and one `\b(?:import|require)\s*\(` to find
// loader calls. It gave WRONG VERDICTS IN BOTH DIRECTIONS, and every case below
// was reproduced against the real gate before this rewrite:
//
//   false FAIL  throw new Error("use require(path) instead")  ← import-shaped TEXT
//   false FAIL  `import(${x})`                                ← inside a template
//   false FAIL  o.import(y) / mod.require(x)                  ← member calls, not loaders
//   false PASS  const re = /https:\/\//; …import(n)           ← the regex's `//` blanked
//                                                               the rest of the line,
//                                                               hiding a real call
//   false PASS  import(`stream${n}`)                          ← "starts with a quote"
//   false PASS  import("zo" + n)                              ← "starts with a quote"
//   false PASS  __require(name)                               ← no \b inside `__require`
//
// The first four are one root cause: a regex cannot know whether the text it
// matched is CODE. So the scan now runs a real (small) tokenizer, `scanSource`,
// which walks the file once and classifies every character as code, comment,
// string, template or regex. Only ONE regex survives, and it is applied
// exclusively to the tokenizer's code-only output, so it can no longer see into a
// literal or a comment at all.
//
// What the tokenizer does NOT do, stated plainly so the next reader does not
// over-trust it (it is a masker, not a parser):
//   • Regex-vs-division is a heuristic on the previous significant token
//     (see REGEX_AFTER_KEYWORD): a regex directly after `)` — `if (x) /re/.test(s)`
//     — is read as division. Regex mode bails at a newline, so the blast radius of
//     a misread is the rest of that ONE line, never the file.
//   • No JSX and no TypeScript syntax. The targets are built `.mjs` / `.cjs`.
//   • Indirect loaders stay invisible to any text scan: `const r = require; r(x)`,
//     `createRequire(...)`, `Function("return import('x')")`, `globalThis["im"+"port"]`.
//     Those are out of reach without evaluating the module.

/** Identifier characters, used for both boundary and keyword lookback. */
const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * A `/` directly after one of these follows a VALUE, so it is division, not the
 * start of a regex literal. (`)` is the deliberate over-approximation noted above.)
 */
const VALUE_BEFORE_SLASH = new Set([")", "]", '"', "'", "`"]);

/**
 * Keywords a regex literal may legally follow. Needed because the character
 * before the `/` in `return /re/.test(s)` is an identifier character, which would
 * otherwise read as division.
 */
const REGEX_AFTER_KEYWORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * Whether the `/` whose previous significant code character sits at `lastIndex`
 * starts a regex literal rather than being a division operator.
 *
 * @param {string} code
 * @param {number} lastIndex - Offset of the last significant code character, or -1.
 * @returns {boolean}
 */
function regexAllowedAfter(code, lastIndex) {
  if (lastIndex < 0) return true; // start of file
  const char = code[lastIndex];
  if (VALUE_BEFORE_SLASH.has(char)) return false;
  // Operators, `(`, `,`, `;`, `{`, `}`, `:` — all positions where a value starts.
  if (!IDENT_CHAR.test(char)) return true;
  let start = lastIndex;
  while (start >= 0 && IDENT_CHAR.test(code[start])) start -= 1;
  return REGEX_AFTER_KEYWORD.has(code.slice(start + 1, lastIndex + 1));
}

/**
 * Single-pass scanner that classifies every character of a JS source file.
 *
 * @param {string} code
 * @returns {{ masked: string, literals: { start: number, end: number, interpolated: boolean, terminated: boolean }[] }}
 *   `masked` has the SAME LENGTH as `code`, with every comment, string, template
 *   and regex character replaced by a space and every newline preserved — so
 *   offsets and line numbers still line up with the original. `literals` holds one
 *   span per string/template literal in source order, `end` exclusive and
 *   including the closing quote; `interpolated` is true for a template containing
 *   `${…}`, and `terminated` is false for a literal the file never closes.
 */
export function scanSource(code) {
  /** @type {[number, number][]} Sorted, non-overlapping ranges to blank. */
  const blanks = [];
  const blank = (from, to) => {
    const start = Math.max(0, from);
    const end = Math.min(code.length, to);
    if (end <= start) return;
    const last = blanks[blanks.length - 1];
    if (last && last[1] === start) last[1] = end;
    else blanks.push([start, end]);
  };

  /** @type {{ start: number, end: number, interpolated: boolean, terminated: boolean }[]} */
  const literals = [];
  /** Enclosing templates we are inside via `${…}`, innermost last. */
  const templates = [];

  let mode = "code";
  let braceDepth = 0;
  let literalStart = -1;
  let interpolated = false;
  // Offset of the last significant CODE character; drives regex-vs-division.
  let lastCode = -1;
  let i = 0;

  while (i < code.length) {
    const char = code[i];

    if (mode === "code") {
      if (char === "/" && code[i + 1] === "/") {
        blank(i, i + 2);
        mode = "line-comment";
        i += 2;
      } else if (char === "/" && code[i + 1] === "*") {
        blank(i, i + 2);
        mode = "block-comment";
        i += 2;
      } else if (char === '"' || char === "'") {
        mode = char === '"' ? "double" : "single";
        literalStart = i;
        interpolated = false;
        blank(i, i + 1);
        i += 1;
      } else if (char === "`") {
        mode = "template";
        literalStart = i;
        interpolated = false;
        blank(i, i + 1);
        i += 1;
      } else if (char === "/" && regexAllowedAfter(code, lastCode)) {
        mode = "regex";
        blank(i, i + 1);
        i += 1;
      } else if (char === "}" && braceDepth === 0 && templates.length) {
        // The `}` closing a `${…}` interpolation: back into the template.
        blank(i, i + 1);
        const frame = templates.pop();
        braceDepth = frame.braceDepth;
        literalStart = frame.literalStart;
        interpolated = true;
        mode = "template";
        i += 1;
      } else {
        if (char === "{") braceDepth += 1;
        else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
        if (!/\s/.test(char)) lastCode = i;
        i += 1;
      }
      continue;
    }

    if (mode === "line-comment") {
      if (char === "\n") mode = "code";
      else blank(i, i + 1);
      i += 1;
      continue;
    }

    if (mode === "block-comment") {
      if (char === "*" && code[i + 1] === "/") {
        blank(i, i + 2);
        mode = "code";
        i += 2;
      } else {
        if (char !== "\n") blank(i, i + 1);
        i += 1;
      }
      continue;
    }

    if (mode === "single" || mode === "double") {
      const quote = mode === "single" ? "'" : '"';
      if (char === "\\") {
        blank(i, i + 2);
        i += 2;
      } else if (char === quote) {
        blank(i, i + 1);
        literals.push({
          start: literalStart,
          end: i + 1,
          interpolated: false,
          terminated: true,
        });
        lastCode = i;
        mode = "code";
        i += 1;
      } else if (char === "\n") {
        // A quoted string cannot span a raw newline, so either the source is
        // invalid or we mis-entered: end the span here rather than let one stray
        // apostrophe swallow the rest of the file.
        literals.push({
          start: literalStart,
          end: i,
          interpolated: false,
          terminated: false,
        });
        mode = "code";
        i += 1;
      } else {
        blank(i, i + 1);
        i += 1;
      }
      continue;
    }

    if (mode === "template") {
      if (char === "\\") {
        blank(i, i + 2);
        i += 2;
      } else if (char === "$" && code[i + 1] === "{") {
        blank(i, i + 2);
        templates.push({ literalStart, braceDepth });
        braceDepth = 0;
        mode = "code";
        i += 2;
      } else if (char === "`") {
        blank(i, i + 1);
        literals.push({
          start: literalStart,
          end: i + 1,
          interpolated,
          terminated: true,
        });
        lastCode = i;
        mode = "code";
        i += 1;
      } else {
        if (char !== "\n") blank(i, i + 1);
        i += 1;
      }
      continue;
    }

    if (mode === "regex" || mode === "regex-class") {
      if (char === "\\") {
        blank(i, i + 2);
        i += 2;
      } else if (char === "\n") {
        // A regex literal cannot span a newline, so we mis-read a division `/`.
        // Recover at the line break: a misread can never reach past one line.
        mode = "code";
        i += 1;
      } else if (mode === "regex" && char === "[") {
        blank(i, i + 1);
        mode = "regex-class";
        i += 1;
      } else if (mode === "regex-class" && char === "]") {
        blank(i, i + 1);
        mode = "regex";
        i += 1;
      } else if (mode === "regex" && char === "/") {
        blank(i, i + 1);
        lastCode = i;
        mode = "code";
        i += 1;
      } else {
        blank(i, i + 1);
        i += 1;
      }
      continue;
    }

    /* c8 ignore next -- unreachable: every mode above continues the loop. */
    i += 1;
  }

  // An unterminated literal at EOF: record it so a loader argument inside it is
  // classified as NOT a complete literal, i.e. reported rather than skipped.
  if (mode === "single" || mode === "double" || mode === "template") {
    literals.push({
      start: literalStart,
      end: code.length,
      interpolated,
      terminated: false,
    });
  }

  const parts = [];
  let cursor = 0;
  for (const [start, end] of blanks) {
    parts.push(code.slice(cursor, start));
    parts.push(code.slice(start, end).replace(/[^\n]/g, " "));
    cursor = end;
  }
  parts.push(code.slice(cursor));
  return { masked: parts.join(""), literals };
}

/**
 * Blanks comments, string/template literals AND regex literals, preserving both
 * length and newlines (and therefore offsets and line numbers).
 *
 * Named for what it does: the previous `stripComments` blanked comments only and
 * left literals intact, which is precisely how import-shaped TEXT reached the
 * loader-call matcher and hard-failed CI on code that links nothing.
 *
 * @param {string} code
 * @returns {string}
 */
export function maskNonCode(code) {
  return scanSource(code).masked;
}

/**
 * Every way a module can pull another one in at runtime, including rolldown's
 * `__require` CJS-interop shim (which `\brequire` misses: there is no word
 * boundary inside `__require`).
 *
 * The lookbehind rejects an identifier that merely ENDS with one of these words
 * (`myrequire(x)`) and the common `o.import(` member form; `precededByMemberDot`
 * then covers the same member call split across lines, which a single-character
 * lookbehind cannot see.
 *
 * Only ever applied to `scanSource`'s masked output, never to raw source.
 */
const LOADER_CALL =
  /(?<![.\w$])(?:__require|require(?:\.resolve)?|import)\s*\(/g;

/**
 * True when the loader word starting at `index` is a property access — `o.import(x)`,
 * `mod?.require(x)`, or the same split over a line break — which loads nothing.
 * `...import(x)` is a spread, not a member access.
 *
 * @param {string} masked
 * @param {number} index
 * @returns {boolean}
 */
function precededByMemberDot(masked, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  return i >= 0 && masked[i] === "." && masked[i - 1] !== ".";
}

/**
 * Offsets of a loader call's FIRST argument, given the offset of its `(`, or null
 * when the call is never closed. Depth-aware over the MASKED source, so a paren or
 * comma inside a string cannot end it. Stopping at the first top-level comma keeps
 * `import("./m", { with: { type: "json" } })` a one-literal argument.
 *
 * @param {string} masked
 * @param {number} openIndex
 * @returns {{ start: number, end: number } | null}
 */
function firstArgumentRange(masked, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return { start: openIndex + 1, end: i };
    } else if (char === "," && depth === 1) {
      return { start: openIndex + 1, end: i };
    }
  }
  return null;
}

/**
 * Whether a loader argument is a COMPLETE single literal — the only shape a
 * bundler can resolve. "Starts with a quote" is not enough, and that was the whole
 * false-negative class: `import("zo" + n)` and `` import(`stream${n}`) `` both
 * start with one and both hide their target.
 *
 * @param {object} options
 * @param {string} options.code - The original source (for the whitespace check).
 * @param {{ start: number, end: number, interpolated: boolean, terminated: boolean }[]} options.literals
 * @param {{ start: number, end: number } | null} options.range
 * @returns {boolean}
 */
function isCompleteLiteralArgument({ code, literals, range }) {
  if (!range) return false;
  const inside = literals.filter(
    (literal) => literal.start >= range.start && literal.end <= range.end,
  );
  if (inside.length !== 1) return false;
  const [literal] = inside;
  if (!literal.terminated || literal.interpolated) return false;
  // Nothing but whitespace may surround it: that is what rejects a concatenation.
  return (
    code.slice(range.start, literal.start).trim() === "" &&
    code.slice(literal.end, range.end).trim() === ""
  );
}

/**
 * Loader calls whose argument is not a complete string literal, and which
 * therefore hide whatever they load from any static analysis — including a
 * bundler's.
 *
 * @param {string} code
 * @returns {string[]} A short excerpt per unanalyzable call.
 */
export function unanalyzableLoaderCalls(code) {
  const { masked, literals } = scanSource(code);
  const found = [];
  for (const match of masked.matchAll(LOADER_CALL)) {
    if (precededByMemberDot(masked, match.index)) continue;
    const openIndex = match.index + match[0].length - 1;
    const range = firstArgumentRange(masked, openIndex);
    if (isCompleteLiteralArgument({ code, literals, range })) continue;
    found.push(
      // Excerpt from the ORIGINAL source: the masked form would print the
      // argument as blanks, which tells a reader nothing.
      code
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
  // esbuild metafile keys use POSIX separators even on Windows.
  const entryKey = path
    .relative(pkgRoot, path.resolve(pkgRoot, entryFile))
    .split(path.sep)
    .join("/");
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

/** Absolute, symlink-resolved form of `p` (unresolvable → merely absolute). */
function realPath(p) {
  const absolute = path.resolve(p);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * True when this module is the process entrypoint.
 *
 * Compares REAL FILESYSTEM PATHS, never URL strings. The obvious string form —
 * `import.meta.url === \`file://${process.argv[1]}\`` — is wrong three ways, and
 * every one of them is silent: `import.meta.url` is percent-encoded (a checkout
 * path containing a SPACE arrives as `%20`) and symlink-resolved (macOS `/tmp` is
 * a symlink to `/private/tmp`), while `argv[1]` is the raw path as typed; and on
 * Windows the URL is `file:///C:/…` against a `C:\…` argv. A false result skips
 * the CLI block below, so this hard-fail gate would exit 0 having printed and
 * asserted NOTHING — the one failure mode a gate must not have.
 *
 * `fs.realpathSync` on both sides is what defeats the symlink case;
 * `fileURLToPath` is what defeats the encoding and Windows cases.
 *
 * Exported for the entry-guard tests. Duplicated verbatim in
 * packages/react-native/scripts/measure-headless.mjs: these are standalone
 * package scripts with no shared module between them.
 *
 * @param {string} moduleUrl - a module's `import.meta.url`.
 * @param {string | undefined} argv1 - `process.argv[1]`.
 */
export function isEntrypoint(moduleUrl, argv1) {
  if (!argv1) return false;
  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    // Not a `file:` URL (e.g. `data:`), so it cannot be the CLI entry.
    return false;
  }
  return realPath(modulePath) === realPath(argv1);
}

// CLI entry — only runs when invoked directly, so importing this module from
// tests does not walk the real dist graph at module-load time.
const isMain = isEntrypoint(import.meta.url, process.argv[1]);

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
