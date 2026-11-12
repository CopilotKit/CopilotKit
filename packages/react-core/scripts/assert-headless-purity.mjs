// Fails if a React-Native-reachable react-core entry breaks its contract.
// @copilotkit/react-native imports three react-core entries (/v2/headless,
// /v2/context and /v2/generative-ui/native, and no other: the test file checks
// this against packages/react-native/src), so Hermes loads all three and Metro
// bundles all three. Each built entry (.mjs and .cjs) is checked against the
// contract for its target (see CONTRACTS below). The HEADLESS contract covers
// /v2/headless and /v2/context, and the NATIVE contract covers
// /v2/generative-ui/native. Both enforce the same rules. They differ only in
// their advice, i.e. where offending code should go instead:
//
//   • No chat-message rendering stack: none of the ~5.5 MB shiki grammars/themes,
//     mermaid, cytoscape, katex or streamdown (issue #4893). /v2/headless exists
//     so consumers with a custom UI can import hooks without that weight, and
//     /v2/context carries CopilotKitCoreReact, so its transitive subtree must stay
//     clean too.
//   • Nothing Hermes or Metro cannot take. The graph may not contain:
//       - the packages react-dom (and its subpaths), lit, lit-html, lit-element,
//         or anything under the @lit/ or @lit-labs/ scopes (lit-html reads
//         `document` while its module loads, which throws under Hermes);
//       - a module of @a2ui/web_core under src/universal/ or
//         src/v0_9/basic_catalog/, which are its Lit-based parts (the
//         `@a2ui/web_core/v0_9` barrel re-exports both). This holds whether the
//         package resolves from node_modules or from a linked local checkout;
//       - a class `static {}` block in ANY JavaScript file of the graph, ours or a
//         dependency's: Metro runs Babel over node_modules too, and its preset
//         cannot parse one. The build lowers a `static` class FIELD such as
//         `static contextType = …` to such a block, so assign that static after
//         the class (`MyBoundary.contextType = …`) instead.
//     These are checks by package name, by resolved path and by syntax. Nothing
//     here detects DOM use in general: a module that reads `document` or `window`
//     without importing one of the packages above is not caught.
//
// A dependency file that its package's `browser` field maps to `false` appears in
// the graph as `(disabled):…`. esbuild bundles an empty module in its place, so it
// ships no code, and every check below skips it instead of calling it unreadable.
//
// (The RN import-graph guard in
// packages/react-native/src/__tests__/headless-entry-surface.test.ts allows these
// same entries but only walks that package's own source; this script walks the
// built graph, so it follows relative chunk edges and into node_modules.)
//
// This is a STRUCTURAL assertion, not a size budget: it names the specific
// regression instead of guarding a byte threshold, so it hard-fails legitimately
// and needs no baseline maintenance. Size *budgets* remain blocked on OSS-122 —
// see dev-docs/bundle-size.md.
//
// ─── Why it drives esbuild instead of grepping the entry files ───────────────
// Reading the entry files and asking `code.includes(dep)` is wrong in both
// directions:
//
//  1. It sees only the entry files, so any violation reached through an edge OUT
//     of them is invisible: a re-export from the fat `@copilotkit/react-core/v2`
//     entry (which links the whole render stack) is just a bare import string in
//     `dist/v2/headless.mjs`; a heavy dep reached through `@copilotkit/core`,
//     which is external to this build, shows up only as `from "@copilotkit/core"`;
//     and a split-out chunk (`import "./chunk-abc.mjs"`) hides the same way.
//  2. `code.includes(dep)` is unanchored, so it matches comments, strings and
//     identifiers. The build output is comment-preserving, and the five banned
//     tokens sit in `src/v2/headless.ts`'s own file banner: the same sentence in
//     any module that ships code would fail CI on all five tokens while linking
//     none of them.
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
// entry hid behind a variable. The first place this script therefore reads text is
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
// too: they cannot reach the render stack, and bundling them buries the signal in
// thousands of inputs. Staying external does not hide them: esbuild still records
// every external import edge in the metafile, and `forbiddenHits` matches those
// specifiers too, which is how both contracts catch a react-dom import.
//
// The static-block check is the second place this script reads text, and it uses
// the same tokenized view (`classStaticBlocks`), so a `static {` in a comment or
// string (such as a comment explaining the workaround above) cannot trip it.
// Unlike the loader-call scan it reads every JavaScript file in the graph,
// node_modules included, because Metro transforms those too; a raw
// `includes("static")` check skips the tokenizer for files that cannot match.
//
// Covered by scripts/__tests__/assert-headless-purity.test.mjs (`test:scripts`).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const FORBIDDEN = ["shiki", "mermaid", "cytoscape", "katex", "streamdown"];

/**
 * What Hermes and Metro cannot take, enforced on every target: each one is
 * imported by @copilotkit/react-native. `lit` stands for the Lit packages in
 * PACKAGE_FAMILIES.lit. The path patterns are matched against an input's
 * package-qualified path (`packagePathFor`), so a linked local checkout of
 * @a2ui/web_core is caught exactly like one under node_modules.
 */
const REACT_NATIVE_RULES = {
  forbidden: [...FORBIDDEN, "react-dom", "lit"],
  forbiddenPaths: [
    /^@a2ui\/web_core\/src\/universal\//,
    /^@a2ui\/web_core\/src\/v0_9\/basic_catalog\//,
  ],
  forbidStaticBlocks: true,
};

const REACT_NATIVE_SUMMARY =
  "must not link the chat-message rendering stack (#4893: " +
  FORBIDDEN.join(", ") +
  "), and, because @copilotkit/react-native loads it under Hermes and bundles " +
  "it with Metro, must not link react-dom, Lit, or the Lit-based parts of " +
  "@a2ui/web_core, and no JavaScript file in its graph may contain a class " +
  "`static {}` block";

const STATIC_BLOCK_ADVICE =
  "For a static block, assign the static after the class\n" +
  "(`MyBoundary.contextType = …`) instead of declaring a `static` class field,\n" +
  "which the build lowers to a `static {}` block (see the header of\n" +
  "scripts/assert-headless-purity.mjs).";

/**
 * What each target may not link. `forbidden` is matched against package names
 * (see `isForbiddenPackage`), `forbiddenPaths` against package-qualified graph
 * inputs, and `forbidStaticBlocks` scans every JavaScript file in the graph for
 * class static blocks. Both contracts carry REACT_NATIVE_RULES; `advice`, printed
 * when a target of that contract breaks it, is what differs.
 */
const CONTRACTS = {
  headless: {
    name: "headless",
    summary: REACT_NATIVE_SUMMARY,
    ...REACT_NATIVE_RULES,
    advice:
      "If a hook you added needs the render stack, it belongs in the main /v2 entry instead,\n" +
      "and so does DOM or Lit code: React Native imports this entry too.\n" +
      STATIC_BLOCK_ADVICE,
  },
  native: {
    name: "native",
    summary: REACT_NATIVE_SUMMARY,
    ...REACT_NATIVE_RULES,
    advice:
      "DOM and Lit code belongs in the web /v2/generative-ui entry, not in\n" +
      "/v2/generative-ui/native. Import @a2ui/web_core models from its DOM-free\n" +
      "subpaths (`@a2ui/web_core/state`, `/catalog`), never the `/v0_9` barrel.\n" +
      STATIC_BLOCK_ADVICE,
  },
};

/**
 * The contract a built target (a path relative to dist/v2) is checked against.
 *
 * @param {string} target - e.g. `headless.mjs` or `generative-ui/native.cjs`.
 * @returns {{ name: string, summary: string, forbidden: string[], forbiddenPaths: RegExp[], forbidStaticBlocks: boolean, advice: string }}
 */
export function contractFor(target) {
  return /^generative-ui\/native\.[cm]js$/.test(target)
    ? CONTRACTS.native
    : CONTRACTS.headless;
}
// `fileURLToPath(import.meta.url)`, not `import.meta.dirname`: the latter landed
// in Node 20.11 and is `undefined` below it, which would turn this hard-fail gate
// into an opaque ERR_INVALID_ARG_TYPE on Node 20.0–20.10, which the root
// package.json's `engines` floor (">=20") still admits. Same idiom as scripts/measure-copilotchat.mjs.
const builtDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/v2",
);
export const targets = [
  "headless.mjs",
  "headless.cjs",
  "context.mjs",
  "context.cjs",
  // @copilotkit/react-native/generative-ui imports this entry.
  "generative-ui/native.mjs",
  "generative-ui/native.cjs",
];

// None of these can reach the render stack, so they stay out of the bundle
// (mirrors scripts/measure-copilotchat.mjs). A web host ships them, while a React
// Native host ships `react` but not react-dom. Externals are still checked:
// `forbiddenHits` reads every external specifier, which is how both contracts
// reject a react-dom import.
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
// Two layered regexes — one comment/string/template alternation to blank
// comments, and one `\b(?:import|require)\s*\(` to find loader calls — give
// WRONG VERDICTS IN BOTH DIRECTIONS:
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
// matched is CODE. So the scan runs a real (small) tokenizer, `scanSource`,
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
 *   span per string/template literal in the order the literals CLOSE (so a string
 *   inside a template's `${…}` comes before that template), `end` exclusive and
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
 * Literals are blanked as well as comments because import-shaped TEXT in a
 * string would otherwise reach the loader-call matcher and fail CI on code that
 * links nothing.
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
 * A `.` preceded by another `.` is a spread, not a member access, so
 * `... import(x)` with whitespace after the spread is still reported. With no
 * whitespace (`...import(x)`, `...require(x)`) the call is NOT reported: the `.`
 * directly before the loader word fails LOADER_CALL's lookbehind, so the match
 * never reaches this function. That is a known gap, not a supported case.
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
 * `static` followed by `{`, the shape of a class static block. A static field
 * (`static x = {}`), a static method (`static f() {}`) and an object key
 * (`{ static: {} }`) all put something else between the two. The lookbehind
 * rejects a member access and an identifier that merely ends in `static`.
 *
 * The shape alone is not enough: outside strict mode `static` is a legal
 * identifier, so sloppy third-party CommonJS can hold `static` at the end of a
 * statement followed by a block on the next line (ASI). `classStaticBlocks`
 * therefore also requires the innermost open brace to be a class body.
 *
 * Only ever applied to `scanSource`'s masked output, never to raw source.
 */
const STATIC_BLOCK = /(?<![.\w$])static\s*\{/y;

/**
 * The `class` keyword, not a property NAMED `class`. The keyword is always
 * followed by its name, `extends` or its body's `{`, so this requires the next
 * code character to start an identifier or be `{`. That rejects a member
 * (`o.class`, `#class`), an object key (`class:`), a method or accessor
 * (`class()`, `get class()`, `static class()`) and a field (`class = …`,
 * `class;`), none of which opens a class body.
 */
const CLASS_KEYWORD = /(?<![.\w$#])class(?![\w$])(?=\s*[{\p{ID_Start}$_\\])/uy;

/**
 * Class static blocks (`static { … }`) in a source file. Metro's Babel preset
 * cannot parse them, so a React Native app fails to bundle any file that has one.
 * Runs over the masked source, so a mention in a comment, string, template or
 * regex is not a block.
 *
 * One pass tracks every open bracket. A `{` opened at the same nesting level as
 * a preceding `class` keyword is that class's body (a `{` inside its `extends`
 * expression sits deeper), and a `static {` counts only directly inside one.
 * Classes waiting for their body form a stack, not a single slot: the `extends`
 * clause can hold class expressions of its own (`class A extends Mixin(class {})`,
 * `class A extends class B {}`), and each of those opens and closes its body
 * before the outer class opens its own.
 *
 * @param {string} code
 * @returns {string[]} `line N: <excerpt>` per block.
 */
export function classStaticBlocks(code) {
  const { masked } = scanSource(code);
  const found = [];
  /** One entry per open bracket: true for a class body. */
  const open = [];
  /**
   * Nesting level of each `class` keyword whose body is not open yet, innermost
   * last. Levels never decrease from bottom to top: an inner class keyword in an
   * `extends` clause sits at the outer one's level or deeper.
   */
  const pending = [];
  for (let i = 0; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === "{") {
      const isClassBody = pending[pending.length - 1] === open.length;
      if (isClassBody) pending.pop();
      open.push(isClassBody);
    } else if (char === "(" || char === "[") {
      open.push(false);
    } else if (char === "}" || char === ")" || char === "]") {
      open.pop();
      // A class keyword left inside a closed bracket never got a body here.
      while (pending.length && pending[pending.length - 1] > open.length) {
        pending.pop();
      }
    } else if (char === "c") {
      CLASS_KEYWORD.lastIndex = i;
      if (CLASS_KEYWORD.test(masked)) pending.push(open.length);
    } else if (char === "s" && open[open.length - 1] === true) {
      STATIC_BLOCK.lastIndex = i;
      if (!STATIC_BLOCK.test(masked)) continue;
      const line = masked.slice(0, i).split("\n").length;
      found.push(
        `line ${line}: ${code
          .slice(i, i + 48)
          .replace(/\s+/g, " ")
          .trim()}`,
      );
    }
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
 * esbuild's metafile key for a file a package's `browser` field maps to `false`.
 * esbuild bundles an empty module in its place, so the file ships no code.
 */
const DISABLED_INPUT = /^\(disabled\):/;

/**
 * Whether a graph input is a file that ships: not one disabled by a `browser`
 * field.
 *
 * @param {string} input
 * @returns {boolean}
 */
export function isShippedInput(input) {
  return !DISABLED_INPUT.test(input);
}

/**
 * `<package name>/<path inside the package>` for a resolved graph input, or null
 * when no named package owns it. Under node_modules this reads the path (the last
 * `node_modules/` segment). Anywhere else, such as a linked local checkout that
 * esbuild resolved through a symlink to its real path, it walks up to the
 * nearest package.json that has a `name`, so a path rule anchored on the package
 * still matches.
 *
 * @param {string} input
 * @param {string} pkgRoot - What `input` is relative to.
 * @param {Map<string, { name: string, dir: string } | null>} [cache] - Directory lookups.
 * @returns {string | null}
 */
export function packagePathFor(input, pkgRoot, cache = new Map()) {
  const name = packageNameFor(input);
  if (name) {
    const parts = input.split("node_modules/");
    return parts[parts.length - 1];
  }
  const absolute = path.resolve(pkgRoot, input);
  const owner = owningPackage(path.dirname(absolute), cache);
  return owner
    ? `${owner.name}/${path.relative(owner.dir, absolute).split(path.sep).join("/")}`
    : null;
}

/** The nearest enclosing package.json with a `name`, memoized per directory. */
function owningPackage(dir, cache) {
  if (cache.has(dir)) return cache.get(dir);
  let owner = null;
  const manifest = path.join(dir, "package.json");
  if (fs.existsSync(manifest)) {
    try {
      const { name } = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (typeof name === "string" && name) owner = { name, dir };
    } catch {
      // An unparsable manifest names nothing; keep walking up.
    }
  }
  if (!owner) {
    const parent = path.dirname(dir);
    owner = parent === dir ? null : owningPackage(parent, cache);
  }
  cache.set(dir, owner);
  return owner;
}

/**
 * Forbidden deps whose packages are listed exactly instead of matched by the
 * prefix rule in `isForbiddenPackage`. `lit` needs this: a prefix would also
 * catch unrelated packages such as `@litert/x`, `@lit-protocol/x` or `@lite/x`.
 * So does `react-dom`, which ships as one package: a prefix would catch
 * `react-dom-confetti` or a `@react-domx/…` scope.
 */
const PACKAGE_FAMILIES = {
  "react-dom": { names: ["react-dom"], scopes: [] },
  lit: {
    names: ["lit", "lit-html", "lit-element"],
    scopes: ["@lit", "@lit-labs"],
  },
};

/**
 * Whether a package name belongs to a forbidden dependency's family.
 *
 * Matches package NAMES, never file contents. A dep listed in PACKAGE_FAMILIES
 * matches exactly its listed names (and their subpaths) and every package in its
 * listed scopes. Any other dep matches by prefix: the name itself, `dep/…`,
 * `dep-…`, and any scope that starts with `@dep` — so `@shikijs/langs` and
 * `cytoscape-fcose` are caught, while `shikimori` and `react-katexish` are not.
 *
 * @param {string} packageName
 * @param {string} dep
 * @returns {boolean}
 */
export function isForbiddenPackage(packageName, dep) {
  const family = PACKAGE_FAMILIES[dep];
  if (family) {
    return (
      family.names.some(
        (name) => packageName === name || packageName.startsWith(`${name}/`),
      ) || family.scopes.some((scope) => packageName.startsWith(`${scope}/`))
    );
  }
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
 * @param {string[]} [options.linkedPackages] - Names of packages whose files are in the graph from outside node_modules (a linked local checkout).
 * @param {string[]} options.forbidden - Dependency names that must not appear.
 * @returns {{ dep: string, via: string[] }[]} One entry per forbidden dep that is present.
 */
export function forbiddenHits({
  inputs,
  externalSpecifiers = [],
  linkedPackages = [],
  forbidden,
}) {
  const names = new Set(linkedPackages);
  for (const input of inputs) {
    if (!isShippedInput(input)) continue;
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
  // esbuild keys the metafile with forward slashes on every platform.
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
 * A first-party input that is not readable is itself reported: a file the scan
 * could not read must not count as clean.
 *
 * @param {object} options
 * @param {string[]} options.inputs
 * @param {string} options.pkgRoot
 * @returns {string[]}
 */
export function unanalyzableEdgesIn({ inputs, pkgRoot }) {
  const found = [];
  for (const input of inputs) {
    if (input.includes("node_modules") || !isShippedInput(input)) continue;
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
 * Graph inputs Metro would run through Babel, by extension: JavaScript and
 * TypeScript sources, never CSS or JSON. The tokenizer reads plain JavaScript
 * only (see `scanSource`), which is what the built targets and node_modules hold;
 * a TypeScript or JSX input would be scanned on a best-effort basis.
 */
const SCRIPT_INPUT = /\.[cm]?[jt]sx?$/;

/**
 * Every class static block in the graph's JavaScript files, node_modules
 * included: Metro runs Babel over dependencies too, so a dependency's static
 * block breaks the bundle exactly like one of ours. A file that does not contain
 * the text `static` cannot hold a block, so it skips the tokenizer.
 *
 * Every unreadable input, first-party or dependency, is returned in
 * `unreadable`: a file this scan could not read cannot be called clean, and this
 * function is exported, so it must not rely on a caller having run
 * `unanalyzableEdgesIn` too (`assertEntryPurity` merges the two lists with
 * `mergeUnreadable`). An input disabled by a `browser` field ships no code and is
 * skipped.
 *
 * @param {object} options
 * @param {string[]} options.inputs
 * @param {string} options.pkgRoot
 * @returns {{ blocks: string[], unreadable: string[] }}
 */
export function staticBlocksIn({ inputs, pkgRoot }) {
  const blocks = [];
  const unreadable = [];
  for (const input of inputs) {
    if (!SCRIPT_INPUT.test(input) || !isShippedInput(input)) continue;
    const absolute = path.resolve(pkgRoot, input);
    if (!fs.existsSync(absolute)) {
      unreadable.push(
        `${input} — in the graph but not readable on disk, so it was not ` +
          `scanned for class static blocks`,
      );
      continue;
    }
    const code = fs.readFileSync(absolute, "utf8");
    if (!code.includes("static")) continue;
    for (const block of classStaticBlocks(code)) {
      blocks.push(`${input} — ${block}`);
    }
  }
  return { blocks, unreadable };
}

/**
 * The unreadable-input reports of `unanalyzableEdgesIn` and `staticBlocksIn` as
 * one list, naming each input once (both scans see the same missing first-party
 * file). Each report starts with `<input> — `.
 *
 * @param {string[]} edges - From `unanalyzableEdgesIn`.
 * @param {string[]} unreadable - From `staticBlocksIn`.
 * @returns {string[]}
 */
export function mergeUnreadable(edges, unreadable) {
  const named = new Set(edges.map((report) => report.split(" — ")[0]));
  return [
    ...edges,
    ...unreadable.filter((report) => !named.has(report.split(" — ")[0])),
  ];
}

/**
 * Walk one built entry's graph and report what in it breaks the contract.
 *
 * @param {object} options
 * @param {string} options.entryFile
 * @param {string} options.pkgRoot
 * @param {string[]} options.forbidden - Package names (and families) that must not appear.
 * @param {RegExp[]} [options.forbiddenPaths] - Package-qualified input paths (`packagePathFor`) that must not appear.
 * @param {boolean} [options.forbidStaticBlocks] - Also report class static blocks in the graph's JavaScript files.
 * @returns {Promise<{ hits: { dep: string, via: string[] }[], pathHits: string[], staticBlocks: string[], inputCount: number, unanalyzable: string[], blindingWarnings: string[], otherWarnings: string[] }>}
 */
export async function assertEntryPurity({
  entryFile,
  pkgRoot,
  forbidden,
  forbiddenPaths = [],
  forbidStaticBlocks = false,
}) {
  const graph = await collectModuleGraph({ entryFile, pkgRoot });
  const { externalSpecifiers, blindingWarnings, otherWarnings } = graph;
  const inputs = graph.inputs.filter(isShippedInput);
  const statics = forbidStaticBlocks
    ? staticBlocksIn({ inputs, pkgRoot })
    : { blocks: [], unreadable: [] };
  const cache = new Map();
  const qualified = inputs.map((input) => ({
    input,
    packagePath: packagePathFor(input, pkgRoot, cache),
  }));
  const linkedPackages = qualified
    .filter(({ input, packagePath }) => packagePath && !packageNameFor(input))
    .map(({ packagePath }) =>
      packagePath.split("/", packagePath.startsWith("@") ? 2 : 1).join("/"),
    );
  return {
    hits: forbiddenHits({
      inputs,
      externalSpecifiers,
      linkedPackages,
      forbidden,
    }),
    pathHits: qualified
      .filter(
        ({ packagePath }) =>
          packagePath &&
          forbiddenPaths.some((pattern) => pattern.test(packagePath)),
      )
      .map(({ input }) => input)
      .sort(),
    staticBlocks: statics.blocks,
    inputCount: graph.inputs.length,
    unanalyzable: mergeUnreadable(
      unanalyzableEdgesIn({ inputs, pkgRoot }),
      statics.unreadable,
    ),
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

/** At most `limit` lines of a long list, so one leak does not flood the log. */
function listed(items, limit = 10) {
  const shown = items
    .slice(0, limit)
    .map((item) => `\n      ${item}`)
    .join("");
  const rest = items.length - limit;
  return rest > 0 ? `${shown}\n      … and ${rest} more` : shown;
}

/**
 * The gate itself: scan every target against its contract, print one line per
 * target, and return the process exit code (0 only when every target was scanned
 * AND meets its contract).
 *
 * Two kinds of failure are kept apart. A target that could not be scanned (not
 * built, an edge that cannot be resolved, an edge the scan cannot see through)
 * gets scan advice. A target whose scan found a definite violation gets that
 * contract's summary and advice, naming only the entries that broke it. A target
 * can be both: an opaque edge hides only what lies behind it, so the violations
 * the scan did see are still reported, with their advice, next to the scan
 * failure.
 *
 * @param {object} options
 * @param {string} options.dist - The built dist/v2 directory.
 * @param {string} options.pkgRoot - Working directory for esbuild resolution.
 * @param {string[]} [options.targets] - Paths relative to `dist`.
 * @param {{ log: Function, warn: Function, error: Function }} [options.log]
 * @returns {Promise<number>}
 */
export async function runGate({
  dist,
  pkgRoot,
  targets: files = targets,
  log = console,
}) {
  /** Failing targets per contract, for the contract advice at the end. */
  const broken = new Map();
  /** Targets that could not be scanned at all. */
  const unscanned = [];
  const brokeContract = (file, contract, message) => {
    log.error(`✗ ${file} ${message}`);
    broken.set(contract, [...(broken.get(contract) ?? []), file]);
  };
  const couldNotScan = (file, message) => {
    log.error(`✗ ${file} ${message}`);
    unscanned.push(file);
  };

  for (const file of files) {
    const full = path.join(dist, file);
    if (!fs.existsSync(full)) {
      couldNotScan(file, "not found");
      continue;
    }

    const contract = contractFor(file);
    let report;
    try {
      report = await assertEntryPurity({
        entryFile: full,
        pkgRoot,
        forbidden: contract.forbidden,
        forbiddenPaths: contract.forbiddenPaths,
        forbidStaticBlocks: contract.forbidStaticBlocks,
      });
    } catch (error) {
      couldNotScan(file, `— ${error.message}`);
      continue;
    }

    for (const text of report.otherWarnings) {
      log.warn(`  (esbuild warning, not fatal) ${file}: ${text}`);
    }
    const opaque = [...report.blindingWarnings, ...report.unanalyzable];
    if (opaque.length) {
      couldNotScan(
        file,
        "has edges this scan cannot follow, so it cannot be called clean:\n  " +
          opaque.join("\n  "),
      );
    }

    const problems = [];
    if (report.hits.length) {
      const detail = report.hits
        .map(({ dep, via }) =>
          via.length === 1 && via[0] === dep
            ? dep
            : `${dep} (via ${via.join(", ")})`,
        )
        .join(", ");
      problems.push(`links forbidden packages: ${detail}`);
    }
    if (report.pathHits.length) {
      problems.push(`links forbidden modules:${listed(report.pathHits)}`);
    }
    if (report.staticBlocks.length) {
      problems.push(
        `has class static blocks, which Metro cannot parse:${listed(report.staticBlocks)}`,
      );
    }
    if (problems.length) {
      brokeContract(
        file,
        contract,
        `breaks the ${contract.name} contract (${report.inputCount} modules in its graph):\n` +
          problems.map((problem) => `  - ${problem}`).join("\n"),
      );
      continue;
    }
    if (opaque.length) continue;
    log.log(
      `✓ ${file} (${fs.statSync(full).size} B, ${report.inputCount} modules in graph) — ` +
        `meets the ${contract.name} contract`,
    );
  }

  for (const [contract, failed] of broken) {
    const entries = failed.map(
      (target) => `/v2/${target.replace(/\.[cm]js$/, "")}`,
    );
    log.error(
      `\n${[...new Set(entries)].join(", ")} (${contract.name} contract) ` +
        `${contract.summary}.\n${contract.advice}`,
    );
  }
  if (unscanned.length) {
    log.error(
      `\n${unscanned.join(", ")} could not be scanned, so the gate cannot say ` +
        `whether ${unscanned.length === 1 ? "it meets its" : "they meet their"} ` +
        `contract. Run \`nx run @copilotkit/react-core:build\` if dist is ` +
        `missing; otherwise fix the edge named above.`,
    );
  }
  return broken.size || unscanned.length ? 1 : 0;
}

// CLI entry — only runs when invoked directly, so importing this module from
// tests does not walk the real dist graph at module-load time.
const isMain = isEntrypoint(import.meta.url, process.argv[1]);

if (isMain) {
  const exitCode = await runGate({
    dist: builtDist,
    pkgRoot: path.resolve(builtDist, "../.."),
  });
  if (exitCode) process.exit(exitCode);
}
