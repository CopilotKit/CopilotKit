import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// Type-only, so it is erased and does NOT statically pull the entry this file
// deliberately loads at runtime (and is not part of the walked graph either —
// the walks start at the package's published entries, ENTRIES and
// generativeUIEntry below, never at this test).
import type * as HeadlessEntry from "../headless";
// Same reason, and additionally: the identity assertion below needs the module
// this entry re-exports FROM, to compare bindings rather than merely count them.
import type * as CoreHeadlessEntry from "@copilotkit/react-core/headless";

/**
 * Guards the import graphs of the published entries of
 * `@copilotkit/react-native`, with `/headless` (src/headless.ts) as the strict
 * case. ENTRIES is derived from package.json `exports`, so the default barrel,
 * `/components` and the polyfill subpaths are walked as well.
 *
 * The second `describe` covers the opt-in `/generative-ui` entry
 * (src/generative-ui/index.ts): it may reach react-core only through `/context`
 * and the DOM-free `/generative-ui/native`, it may reach the `zod` optional
 * peer, it owns no registry, and no OTHER entry may reach it or any
 * generative-UI subpath of a workspace package (that deny-list is derived from
 * the packages' `exports` maps). The third `describe` checks react-core's built
 * dist for a second copy of a generative UI context module.
 *
 * The whole point of the headless entry is that a consumer using only the
 * provider + agent/tool hooks does NOT have to install (or Metro-stub) the
 * chat/attachment native peer deps. That guarantee lives in the *static import
 * graph*: if any module reachable from src/headless.ts imports the chat
 * components or `useAttachments` — which pull `@gorhom/bottom-sheet`,
 * `expo-document-picker`, `expo-file-system` — the guarantee is silently broken
 * (nothing in a normal typecheck/test catches it, because those are optional
 * peers). This walks the relative-import graph and fails if that happens.
 *
 * Mirrors the export-surface guard added for @copilotkit/react-core/headless
 * (PR #5883).
 *
 * ─── Why the walker looks the way it does ──────────────────────────────────
 * A guard that under-reports is worse than no guard, because it is trusted. The
 * first version of this file had five blind spots, each of which let a REAL
 * violation through (or flagged a non-violation), so the walker below is written
 * to close them and each is covered by a test:
 *
 *  1. It only saw `import … from "x"`. A lazy optional-peer
 *     `require("@copilotkit/react-core")` or `await import(…)` — which Metro
 *     follows and bundles just the same — was invisible. Now static, bare
 *     side-effect, dynamic `import()` and `require()` are all extracted, and a
 *     loader whose argument is NOT a literal is reported as unanalyzable rather
 *     than ignored.
 *  2. It matched raw text, so doc comments counted as imports. That was not
 *     hypothetical: it was harvesting EIGHT specifiers (`@copilotkit/react-native`,
 *     `…/headless`, `…/polyfills` and its five subpaths) that NO source file
 *     imports (half the reported bare-specifier set), purely from JSDoc
 *     examples. In the other direction, a "don't do this: import from
 *     @copilotkit/react-core" counter-example written in a doc comment failed
 *     the build. Comments are stripped before matching now.
 *  3. `resolveLocal` returned null for an edge it could not resolve and the
 *     caller dropped it, so an unresolvable specifier read as "clean" while
 *     hiding a whole subgraph behind it (e.g. an ESM-style `"./foo.js"` pointing
 *     at `foo.ts`). Unresolvable edges are now resolved where possible and FAIL
 *     LOUDLY where not, and the walk has a non-vacuity floor so a truncated
 *     graph cannot make the deny-lists below pass for the wrong reason.
 *  4. The graph was walked in the `describe` body, so a missing entry file threw
 *     at COLLECTION time and every test in the file — including the one
 *     asserting the entry exists — silently never ran. The walk is lazy and
 *     memoized per entry now, and happens inside test bodies.
 *  5. Four separate tests each did `await import("../headless")`, so four tests
 *     raced the SAME one-time module-graph cost against the default 5s per-test
 *     budget — and when the first one lost that race the other three inherited
 *     its in-flight import and timed out with it (the observed signature was 3
 *     failures at once, not 1). Measured at up to 4568ms, i.e. 91% of the budget
 *     (see IMPORT_BUDGET_MS), so the file timed out nondeterministically — a
 *     flaky hard gate, which is a gate people learn to ignore. The runtime-export
 *     checks now share ONE explicitly-budgeted `beforeAll`, so the cost lives in
 *     exactly one place instead of being raced four times.
 */

const srcDir = path.resolve(__dirname, "..");
const headlessEntry = path.join(srcDir, "headless.ts");

// Bare module specifiers a headless consumer must NOT be forced to resolve.
const FORBIDDEN_BARE = [
  "@gorhom/bottom-sheet",
  "expo-document-picker",
  "expo-file-system",
  "react-native-streamdown",
];

// Local modules that carry the chat UI / native-attachment stack.
const FORBIDDEN_LOCAL = [
  "CopilotChat",
  "CopilotModal",
  "CopilotSidebar",
  "CopilotPopup",
  "use-attachments",
];

// The one react-core entry this package's hooks come from.
const CORE_HEADLESS = "@copilotkit/react-core/headless";

// ─── #4893 bundle guard ──────────────────────────────────────────────────────
// @copilotkit/react-core (the "fat" entry) re-exports from a monolithic chunk
// that pulls the chat-message rendering stack: streamdown -> shiki (~5.5 MB of
// grammars + themes), plus mermaid, cytoscape and katex. Metro does not
// tree-shake, so ONE import of that specifier from anywhere in this package puts
// all of it in every consumer's app bundle (issue #4893). PR #5883 moved the lean
// hooks into /headless precisely so this package never needs the fat entry.
const ALLOWED_REACT_CORE_ENTRIES = [
  CORE_HEADLESS,
  "@copilotkit/react-core/context",
];

/**
 * Registry-owning APIs and primitives no module in the headless graph may use.
 *
 * `CopilotKitCoreReact` is the ONE render-tool/tool registry, and this package
 * reaches it only through react-core's hooks. That is not a style preference: RN
 * used to keep its own `Map` behind a `RenderToolProvider`, and the consequences
 * were that `useComponent` (which registers into core's registry) rendered
 * nowhere on RN, and that renderers vanished from chat history on unmount.
 *
 * This sits alongside the two identity assertions below rather than behind
 * them. Identity pins what `useFrontendTool` and `useRenderTool` ARE; this pins
 * that nothing ELSE in the graph has grown a registry to compete with core's —
 * a component, a provider, a helper module that never touches either hook's
 * name and would therefore pass identity untouched.
 */
const FORBIDDEN_REGISTRY_APIS: readonly (readonly [
  identifier: string,
  why: string,
])[] = [
  [
    "addTool",
    "registers a frontend tool directly — go through react-core's `useFrontendTool`",
  ],
  [
    "removeTool",
    "unregisters a frontend tool directly — go through react-core's `useFrontendTool`",
  ],
  [
    "addHookRenderToolCall",
    "writes a renderer into the registry directly — go through react-core's `useRenderTool` / `useFrontendTool`",
  ],
  [
    "renderToolCalls",
    "reads or writes the renderer registry directly — go through react-core's `useRenderToolCall`",
  ],
  [
    "createContext",
    "a React context in the headless graph is how an RN-local registry would be rebuilt (`RenderToolProvider` was exactly that). If a context here is genuinely unrelated to tool registration, exempt it deliberately in this list with a reason",
  ],
];

// Heavy modules that must never appear as a direct import from this package.
// (Transitive leakage through react-core's own entry is covered separately by
// packages/react-core/scripts/assert-headless-purity.mjs — this walker cannot
// follow into node_modules.)
const FORBIDDEN_HEAVY = [
  "shiki",
  "mermaid",
  "cytoscape",
  "katex",
  "streamdown",
  "@copilotkit/web-inspector",
  "@copilotkit/runtime-client-gql",
];

/**
 * Deliberate exceptions to FORBIDDEN_REGISTRY_APIS. Each one removes exactly
 * the declaration it names from that one file before the scan, so a second
 * context (or any other registry API) in the same file still trips the ban.
 *
 * `file` is POSIX-style relative to src/, and is compared after normalising
 * `path.relative`'s separators (which are `\` on Windows).
 *
 * Every declaration must match exactly once in the file it names. One that no
 * longer matches (the declaration was reformatted, renamed or removed, or the
 * file moved) is reported as a STALE exemption, naming the exemption and its
 * reason, rather than doing nothing and leaving the identifier ban to blame
 * `createContext` for what is really an out-of-date exemption.
 */
interface RegistryApiExemption {
  file: string;
  /** Each is replaced by its group 1 (what to keep), once. */
  declarations: RegExp[];
  reason: string;
}

const REGISTRY_API_EXEMPTIONS: readonly RegistryApiExemption[] = [
  {
    file: "components/MarkdownRendererContext.tsx",
    declarations: [
      /(import React, \{ )createContext, /,
      /(const Ctx = )createContext<MarkdownRendererValue \| undefined>\(undefined\);/,
    ],
    reason:
      "holds the provider-level `markdownRenderer` (a component, or config for the built-in markdown renderer). It stores no tools and no tool-call renderers",
  },
  {
    file: "generative-ui/GenerativeUIProvider.tsx",
    declarations: [
      /(import React, \{ )createContext, /,
      /()export const GenerativeUIProviderPresentContext = createContext\(false\);/,
    ],
    reason:
      "a boolean that tells the components below 'no provider' from 'a provider without ui'; it holds no tools or renderers",
  },
];

/** A path relative to src/, with `/` separators on every platform. */
const srcRelative = (file: string) =>
  path.relative(srcDir, file).replace(/\\/g, "/");

/** How many times `re` matches `code`, ignoring its own `g` flag. */
const countMatches = (code: string, re: RegExp) =>
  [...code.matchAll(new RegExp(re.source, re.flags.replace("g", "") + "g"))]
    .length;

/**
 * Every use of a FORBIDDEN_REGISTRY_APIS identifier in the given modules, as
 * `file: identifier — why`, plus every stale exemption among the files given.
 * Comments are stripped first: the modules name these APIs in prose to explain
 * why they do NOT call them, and a raw text match would fail on the
 * documentation.
 */
function registryOffenders(
  files: Iterable<string>,
  exemptions: readonly RegistryApiExemption[] = REGISTRY_API_EXEMPTIONS,
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const here = srcRelative(file);
    let code = stripComments(fs.readFileSync(file, "utf8"));
    const applied = exemptions.filter((e) => e.file === here);
    for (const exemption of applied) {
      for (const declaration of exemption.declarations) {
        const matches = countMatches(code, declaration);
        if (matches !== 1) {
          offenders.push(
            `${here}: stale exemption — ${declaration} matched ${matches} ` +
              `time(s), not once. Update or remove the exemption for ` +
              `"${exemption.reason}"`,
          );
        }
        code = code.replace(declaration, "$1");
      }
    }
    for (const [identifier, why] of FORBIDDEN_REGISTRY_APIS) {
      if (new RegExp(`\\b${identifier}\\b`).test(code)) {
        const exempted = applied.length
          ? ` (this file's exemption, "${applied
              .map((e) => e.reason)
              .join("; ")}", does not cover this use)`
          : "";
        offenders.push(`${here}: ${identifier} — ${why}${exempted}`);
      }
    }
  }
  return offenders;
}

const indexEntry = path.join(srcDir, "index.ts");
const pkgJsonPath = path.resolve(srcDir, "..", "package.json");

/**
 * Modules the headless graph MUST reach. Purely a non-vacuity floor: every other
 * graph assertion in this file is a deny-list, and a deny-list over an EMPTY set
 * passes. If the walker ever silently stops walking (a resolver regression, a
 * renamed entry), this is the test that says so instead of the whole file going
 * green while checking nothing.
 */
const REQUIRED_HEADLESS_MODULES = [
  "headless.ts",
  "CopilotKitProvider.tsx",
  "polyfills.ts",
];
const REQUIRED_HEADLESS_BARE = ["@copilotkit/react-core/headless"];

interface PkgManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * The packages a headless consumer is GUARANTEED to be able to resolve: this
 * package's own `dependencies` plus its NON-optional `peerDependencies`.
 *
 * That set is exactly the promise the headless entry sells — "install this and
 * bundle, without stubbing anything in metro.config.js" — so it is the right
 * allow-list, and it is READ from package.json rather than hand-copied so it
 * cannot drift from the manifest it is meant to describe. Anything else in the
 * graph is a package the consumer may not have: every optional peer
 * (`@gorhom/bottom-sheet`, `expo-document-picker`, `expo-file-system`,
 * `react-native-gesture-handler`, `react-native-reanimated`,
 * `react-native-streamdown`, `zod`), any brand-new third-party edge, and any
 * Node builtin (which RN has no business reaching).
 *
 * The walk covers this package's OWN sources only, so this set bounds what
 * THEY import, not what the consumer must install in total. `zod` is the case
 * in point: it is an optional peer here, and no module of this package imports
 * it, yet every entry needs it at runtime — react-core's `/headless`, which
 * both entries import, loads `zod` on import, and react-core declares it as a
 * REQUIRED peer (`>=3.25`). It stays an optional peer at `>=3.0.0` here only
 * because making a peer required, or narrowing its range, is a breaking change
 * under scripts/release/lib/breaking-change-gate.ts; react-core's own peer is
 * what makes the consumer install it, at `>=3.25`.
 *
 * This package's OWN name is deliberately absent, which is what keeps
 * this test doubling as the comment-stripping regression: the eight phantom
 * `@copilotkit/react-native…` specifiers that JSDoc examples used to harvest are
 * all self-references, so if `stripComments` regresses they fail here.
 *
 * What this set does NOT police is WHICH ENTRY of an allowed package is imported:
 * `@copilotkit/react-core` is a legitimate dependency, so the fat
 * `@copilotkit/react-core` passes here and is caught by the dedicated
 * ALLOWED_REACT_CORE_ENTRIES test (which is package-wide, i.e. stricter). Keep
 * both — this one is the catch-all for UNENUMERATED packages, that one is the
 * #4893 entry ban.
 */
function guaranteedPackages(): Set<string> {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as PkgManifest;
  const optional = pkg.peerDependenciesMeta ?? {};
  const guaranteed = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}).filter(
      (name) => !optional[name]?.optional,
    ),
  ]);
  // Fail loud rather than allow-list nothing (which would make the assertion
  // below scream about every legitimate import) or everything.
  expect(
    guaranteed.size,
    `read no dependencies from ${pkgJsonPath} — the allow-list would be meaningless`,
  ).toBeGreaterThan(0);
  return guaranteed;
}

/** `@scope/pkg/sub/path` -> `@scope/pkg`; `pkg/sub` -> `pkg`. */
function packageNameOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/**
 * `@copilotkit/react-core` or one of its subpaths — by package name, not by
 * prefix, so a sibling package such as `@copilotkit/react-core-foo` is not
 * mistaken for an entry of react-core.
 */
const isReactCoreSpec = (spec: string) =>
  packageNameOf(spec) === "@copilotkit/react-core";

/**
 * Comment / string / template alternation, scanned left-to-right in ONE pass.
 *
 * Matching strings with the SAME alternation is what makes comment stripping
 * correct: a `//` inside a string literal is consumed as part of the string
 * before the comment branch can see it, and a quote inside a comment is consumed
 * as part of the comment. `'` and `"` deliberately do not cross a newline, so an
 * unbalanced apostrophe in prose ("doesn't") cannot swallow the rest of a file.
 */
const COMMENT_OR_LITERAL =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * Blanks out comments, preserving newlines (and therefore line numbers) and
 * leaving real string/template literals untouched.
 */
function stripComments(code: string): string {
  return code.replace(COMMENT_OR_LITERAL, (match) =>
    match.startsWith("//") || match.startsWith("/*")
      ? match.replace(/[^\n]/g, " ")
      : match,
  );
}

// Every way this package could reach another module. `import`/`export … from`
// and bare side-effect `import "x"` are the static forms; `import()` and
// `require()` are the lazy forms Metro follows all the same — omitting them let
// a lazily-required fat entry defeat the whole guard.
const SPEC_PATTERNS: RegExp[] = [
  // import … from "x" / export … from "x" / export * as ns from "x"
  /\b(?:import|export)\b[^;"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
  // import "x"  (side effect)
  /\bimport\s*["'`]([^"'`]+)["'`]/g,
  // import("x") / await import("x")
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
  // require("x") / require.resolve("x")
  /\brequire(?:\.resolve)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
];

// A loader whose argument is not a string literal — `require(name)`,
// `import(`@scope/${pkg}`)`. Statically unanalyzable, so it must be reported
// rather than skipped: silence here is exactly how a fat-entry import hides.
const OPAQUE_LOADER =
  /\b(?:import|require(?:\.resolve)?)\s*\(\s*(?!["'`]\s*[^"'`$]*["'`]\s*\))([^)]*)\)/g;

function extractSpecs(code: string): { specs: string[]; opaque: string[] } {
  const specs = new Set<string>();
  const opaque = new Set<string>();

  for (const re of SPEC_PATTERNS) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (!spec) continue;
      // A template with an interpolation is not a resolvable specifier.
      if (spec.includes("${")) opaque.add(spec);
      else specs.add(spec);
    }
  }
  for (const m of code.matchAll(OPAQUE_LOADER)) {
    const arg = m[1]?.trim();
    if (arg) opaque.add(arg);
  }
  return { specs: [...specs], opaque: [...opaque] };
}

function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  // TS source is allowed to spell a relative import with the EMITTED extension
  // (`./foo.js` for `foo.ts`). Without these rewrites such an edge resolves to
  // nothing, and the old walker then dropped the entire subgraph behind it.
  const rewritten = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  const candidates = [
    base,
    ...[base, rewritten].flatMap((b) => [
      `${b}.ts`,
      `${b}.tsx`,
      `${b}.mts`,
      `${b}.cts`,
      path.join(b, "index.ts"),
      path.join(b, "index.tsx"),
    ]),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * The module specifier a VALUE export is re-exported from, or null.
 *
 * Matches either side of an `as` (the local name is the one whose
 * implementation is in question; the exported name is what a consumer imports)
 * and skips `export type { … }` blocks, which carry no runtime binding.
 */
function reExportSpecifierOf(code: string, name: string): string | null {
  const stripped = stripComments(code);
  const re = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const m of stripped.matchAll(re)) {
    if (m[1]) continue;
    for (const raw of m[2]!.split(",")) {
      const clause = raw.trim();
      if (!clause || /^type\s+/.test(clause)) continue;
      const [local, exported] = clause.split(/\s+as\s+/).map((s) => s.trim());
      if (local === name || exported === name) return m[3]!;
    }
  }
  return null;
}

interface Graph {
  /** Every source file reachable from the entry, including the entry. */
  seen: Set<string>;
  /** Every bare (non-relative) specifier reached from those files. */
  bareSpecs: Set<string>;
  /** Relative edges that resolved to no file — asserted empty, never dropped. */
  unresolved: string[];
  /** Loader calls with a non-literal argument — asserted empty. */
  opaque: string[];
}

function walkGraph(entry: string): Graph {
  const seen = new Set<string>();
  const bareSpecs = new Set<string>();
  const unresolved: string[] = [];
  const opaque: string[] = [];
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const code = stripComments(fs.readFileSync(file, "utf8"));
    const here = path.relative(srcDir, file);
    const { specs, opaque: opaqueHere } = extractSpecs(code);

    for (const arg of opaqueHere) opaque.push(`${here}: ${arg}`);

    for (const spec of specs) {
      if (spec.startsWith(".")) {
        const resolved = resolveLocal(file, spec);
        if (resolved) {
          stack.push(resolved);
        } else {
          unresolved.push(`${here} -> ${spec}`);
        }
      } else {
        bareSpecs.add(spec);
      }
    }
  }
  return { seen, bareSpecs, unresolved, opaque };
}

// Memoized so each test body can ask for a graph without the walk running in the
// `describe` body — where a throw would kill COLLECTION and silently take every
// test in this file with it (including the one asserting the entry exists).
const graphCache = new Map<string, Graph>();
function graphFor(entry: string): Graph {
  let graph = graphCache.get(entry);
  if (!graph) {
    graph = walkGraph(entry);
    graphCache.set(entry, graph);
  }
  return graph;
}

const rel = (files: Iterable<string>) =>
  [...files].map((f) => path.relative(srcDir, f)).sort();

interface ExportingManifest extends PkgManifest {
  name?: string;
  exports?: unknown;
}

const readManifest = (file: string) =>
  JSON.parse(fs.readFileSync(file, "utf8")) as ExportingManifest;

/**
 * The file an export resolves to for `import` (else `require`, else
 * `default`), following nested condition objects; null for anything else.
 */
function exportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const condition of ["import", "require", "default"]) {
      const target = exportTarget(
        (value as Record<string, unknown>)[condition],
      );
      if (target) return target;
    }
  }
  return null;
}

/** `./dist/a/b.mjs` -> the `src/a/b.ts(x)` tsdown built it from, if any. */
function sourceOfDistTarget(target: string): string | null {
  const m = /^\.\/dist\/(.+)\.(?:mjs|cjs|js)$/.exec(target);
  if (!m) return null;
  const base = path.join(srcDir, ...m[1]!.split("/"));
  return [`${base}.ts`, `${base}.tsx`].find((c) => fs.existsSync(c)) ?? null;
}

/** An export subpath, or bare specifier, with a `generative-ui` segment. */
const hasGenerativeUISegment = (subpath: string) =>
  subpath.split("/").includes("generative-ui");

/** Export keys of this package that carry no module to walk, and why. */
const NON_CODE_EXPORTS: Record<string, string> = {
  "./package.json": "the manifest itself",
};

/**
 * The entries to walk, DERIVED from this package's `exports` map rather than
 * typed in: a hand-written list missed the published `/components` entry, so
 * none of the per-entry bans below applied to it. Every code export lands in
 * exactly one place — `entries` (all the bans below), or `generativeUI` (the
 * opt-in entry, walked by its own `describe`) — and anything that cannot be
 * mapped back to a source module is a `problem`, which a test fails on.
 *
 * Runs at collection time, so it must not throw (blind spot #4 above):
 * failures are collected, not raised.
 */
function deriveEntries(): {
  entries: [label: string, entry: string][];
  generativeUI: string[];
  problems: string[];
} {
  const entries: [string, string][] = [];
  const generativeUI: string[] = [];
  const problems: string[] = [];
  try {
    const exportsMap = readManifest(pkgJsonPath).exports;
    if (!exportsMap || typeof exportsMap !== "object") {
      return { entries, generativeUI, problems: ["no `exports` map"] };
    }
    for (const [key, value] of Object.entries(exportsMap)) {
      if (key in NON_CODE_EXPORTS) continue;
      const target = exportTarget(value);
      const source = target ? sourceOfDistTarget(target) : null;
      if (!source) {
        problems.push(
          `${key} -> ${target ?? JSON.stringify(value)}: no src/ module found ` +
            `for it. Teach sourceOfDistTarget the new layout, or add the key ` +
            `to NON_CODE_EXPORTS with a reason.`,
        );
      } else if (hasGenerativeUISegment(key)) {
        generativeUI.push(source);
      } else {
        entries.push([`@copilotkit/react-native${key.slice(1)}`, source]);
      }
    }
  } catch (err) {
    problems.push(`could not read the exports of ${pkgJsonPath}: ${err}`);
  }
  return { entries, generativeUI, problems };
}

const DERIVED_ENTRIES = deriveEntries();

// Never empty at collection, so the it.each tables below always register: if
// the derivation broke, they fall back to the two entries this guard was first
// written for, and the derivation test reports why.
const ENTRIES: [label: string, entry: string][] = DERIVED_ENTRIES.entries.length
  ? DERIVED_ENTRIES.entries
  : [
      ["@copilotkit/react-native/headless", headlessEntry],
      ["@copilotkit/react-native", indexEntry],
    ];

/** Entries the derivation must find. A floor, not the list. */
const REQUIRED_ENTRIES = [
  headlessEntry,
  indexEntry,
  path.join(srcDir, "components", "index.ts"),
];

describe("@copilotkit/react-native/headless entry", () => {
  it("walks every code export of package.json", () => {
    expect(
      DERIVED_ENTRIES.problems,
      `package.json exports that this guard cannot map to an entry module:\n  ` +
        DERIVED_ENTRIES.problems.join("\n  "),
    ).toEqual([]);
    const walked = ENTRIES.map(([, entry]) => entry);
    const missing = REQUIRED_ENTRIES.filter((e) => !walked.includes(e));
    expect(
      missing,
      `the entries derived from package.json exports do not include ` +
        `${rel(missing).join(", ")} — the derivation is broken. Derived: ` +
        `${rel(walked).join(", ")}`,
    ).toEqual([]);
    // The opt-in entry is walked by its own describe below, against the path
    // it hard-codes; make sure that path is the one package.json publishes.
    expect(
      DERIVED_ENTRIES.generativeUI,
      "package.json's generative-ui export(s) do not resolve to the entry the " +
        "generative UI describe walks",
    ).toEqual([path.join(srcDir, "generative-ui", "index.ts")]);
  });

  // Runs for real now: nothing walks the graph before collection finishes, so a
  // missing entry file reports HERE instead of erroring the whole suite out.
  it.each(ENTRIES)("has a %s entry file", (_label, entry) => {
    expect(fs.existsSync(entry), `missing entry file: ${entry}`).toBe(true);
  });

  // Fail-loud, both entries: an edge the walker cannot follow means every check
  // below is reasoning about an incomplete graph, so it must never pass quietly.
  it.each(ENTRIES)(
    "%s entry graph resolves every relative import",
    (_label, entry) => {
      const { unresolved } = graphFor(entry);
      expect(
        unresolved,
        `unresolvable relative imports — the walker cannot see past these, so a ` +
          `forbidden import hidden behind one would read as clean: ${unresolved.join(", ")}`,
      ).toEqual([]);
    },
  );

  it.each(ENTRIES)(
    "%s entry graph contains no statically unanalyzable import()/require()",
    (_label, entry) => {
      const { opaque } = graphFor(entry);
      expect(
        opaque,
        `import()/require() with a non-literal specifier cannot be checked for ` +
          `#4893 violations. Make it a literal, or extend this guard: ${opaque.join(", ")}`,
      ).toEqual([]);
    },
  );

  // The non-vacuity floor for every deny-list in this file (see
  // REQUIRED_HEADLESS_MODULES). A subset check, so adding a module is free.
  it("headless graph walk reaches the modules it must reach", () => {
    const { seen, bareSpecs } = graphFor(headlessEntry);
    const modules = rel(seen);
    const missing = REQUIRED_HEADLESS_MODULES.filter(
      (m) => !modules.includes(m),
    );
    expect(
      missing,
      `the walk did not reach ${missing.join(", ")} — every deny-list below is ` +
        `then reasoning about a truncated graph and passes for the wrong reason. ` +
        `Reached: ${modules.join(", ")}`,
    ).toEqual([]);
    const missingBare = REQUIRED_HEADLESS_BARE.filter((s) => !bareSpecs.has(s));
    expect(
      missingBare,
      `no edge to ${missingBare.join(", ")} was harvested — the specifier ` +
        `extractor is not seeing imports it must see`,
    ).toEqual([]);
  });

  // Replaces an EXACT pin of the resolved graph (module list + bare-specifier
  // list, both `toEqual`). The pin's intent was a catch-all: any new edge,
  // including a heavy dependency nobody has enumerated yet, had to be looked at
  // deliberately. Its cost was that it also failed on innocent growth — a new
  // first-party `src/` module, or a second import of an already-sanctioned
  // package — putting a red check on unrelated PRs. A guard that fails on
  // innocent changes gets deleted by the third person who hits it, and then it
  // guards nothing, so the catch-all is expressed here as an allow-list over
  // PACKAGES instead of a snapshot of MODULES: adding first-party modules is
  // free, adding a third-party edge is not.
  it("headless graph draws only on packages a consumer is guaranteed to have", () => {
    const { seen, bareSpecs } = graphFor(headlessEntry);
    const guaranteed = guaranteedPackages();
    const unsanctioned = [...bareSpecs]
      .filter((spec) => !guaranteed.has(packageNameOf(spec)))
      .sort();
    expect(
      unsanctioned,
      `the headless graph reaches package(s) a consumer is not guaranteed to ` +
        `have installed: ${unsanctioned.join(", ")}. The headless entry's whole ` +
        `promise is that it bundles with nothing stubbed, so an edge here must ` +
        `be a dependency or a non-optional peer in package.json — add it there ` +
        `deliberately (and mind #4893: heavy is still forbidden below), or drop ` +
        `the import. Graph: ${rel(seen).join(", ")}`,
    ).toEqual([]);
  });

  it("does not pull chat/attachment native peer deps into its import graph", () => {
    const { bareSpecs } = graphFor(headlessEntry);
    const leaked = FORBIDDEN_BARE.filter((dep) =>
      [...bareSpecs].some((s) => s === dep || s.startsWith(`${dep}/`)),
    );
    expect(
      leaked,
      `headless graph must not import: ${leaked.join(", ")}`,
    ).toEqual([]);
  });

  it("does not reach the chat UI / useAttachments modules", () => {
    const { seen } = graphFor(headlessEntry);
    const reached = [...seen].filter((f) =>
      FORBIDDEN_LOCAL.some((name) =>
        path
          .basename(f)
          .replace(/\.tsx?$/, "")
          .includes(name),
      ),
    );
    expect(
      reached,
      `headless graph must not reach: ${rel(reached).join(", ")}`,
    ).toEqual([]);
  });

  it("owns no tool/renderer registry of its own anywhere in the headless graph", () => {
    const { seen } = graphFor(headlessEntry);
    // Non-vacuity comes from REQUIRED_HEADLESS_MODULES above (a truncated walk
    // fails there first), so this only has to be a deny-list.
    const offenders = registryOffenders(seen);
    expect(
      offenders,
      `module(s) in the headless graph touch registry internals directly:\n  ` +
        `${offenders.join("\n  ")}\n` +
        `CopilotKitCoreReact is the single registry and this package must reach ` +
        `it only through react-core's hooks.`,
    ).toEqual([]);
  });

  /**
   * The six checks below need the entry EVALUATED, not just read: they assert
   * that the named exports exist as runtime values (a re-export of a name that
   * no longer exists is a runtime hole a static read cannot see). So the import
   * stays — but it is paid exactly once, in a hook, rather than being raced by
   * six tests against the default per-test budget.
   *
   * Why the budget below is what it is. Nothing here is hung or polling — the
   * cost is a ONE-TIME module-graph load (resolve + transform + evaluate), paid
   * per worker with no persistent transform cache, and it is the VARIANCE rather
   * than the mean that broke the 5s default:
   *
   *   - vitest.config.mjs sets `server.deps.inline: [/@copilotkit/]`, so the
   *     workspace dists this entry pulls are transformed rather than loaded
   *     natively: ~283 KB (core ~218 KB, react-core /headless ~55 KB, plus
   *     /context and shared), on top of the 11 RN source modules.
   *   - Measured on one dev machine: ~0.9–1.8s inside the full suite as it
   *     was then (22 test files; there are more now) (n=8), ~0.7–1.1s for
   *     this file alone (n=8) — but 4568ms on the run straight after a cold
   *     `nx build`, i.e. 91% of the 5s budget, and the 4 independent
   *     agents who hit this hit it as an outright timeout. Bare
   *     Node `import()` of the equivalent prebuilt dist is 461ms, so the spread
   *     is resolve/transform and page-cache-cold I/O, both load-sensitive.
   *
   * So the budget is a CEILING for a cold, loaded or slower (CI) machine, NOT an
   * expected duration: the happy path stays ~1s and every test below reports
   * ~0ms. A genuinely hung import still fails, just not spuriously. Lowering it
   * re-introduces the flake; lowering the COST would mean not inlining
   * `@copilotkit/core` for this suite, which is a shared-config change affecting
   * every test file in this package rather than something this file can do.
   */
  const IMPORT_BUDGET_MS = 60_000;

  // Nested so the hook's failure domain covers ONLY the tests that need the
  // module. Hoisting it to the top-level `describe` would let an import failure
  // take down the fs-only graph tests above — the same collection-time
  // blast-radius problem as blind spot #4, just moved into a hook.
  describe("runtime export surface", () => {
    let mod: typeof HeadlessEntry;
    let coreHeadless: typeof CoreHeadlessEntry;

    beforeAll(async () => {
      // Both loads live in the ONE budgeted hook. core's /headless is already
      // inside this entry's own graph, so importing it here is a module-cache
      // hit rather than a second traversal.
      [mod, coreHeadless] = await Promise.all([
        import("../headless"),
        import("@copilotkit/react-core/headless"),
      ]);
    }, IMPORT_BUDGET_MS);

    it("does export the provider + core headless hooks", () => {
      for (const name of [
        "CopilotKitProvider",
        "useCopilotKit",
        "useAgent",
        "useFrontendTool",
        "useRenderTool",
      ]) {
        expect(mod, `missing export: ${name}`).toHaveProperty(name);
      }
    });

    it("exports the render-tool consumption hooks from the headless entry", () => {
      // useRenderToolCall: renders a registered component on ANY surface, not
      // just the chat (an in-car stage, a kiosk, a dashboard). useComponent: the
      // controlled generative-UI primitive. Both come from react-core now.
      for (const name of [
        "useRenderToolCall",
        "useComponent",
        "useRenderTool",
      ]) {
        expect(mod, `missing export: ${name}`).toHaveProperty(name);
      }
    });

    it("exports react-core's `useFrontendTool` ITSELF, not an RN copy of it", () => {
      // IDENTITY, which the two presence checks above deliberately do not assert
      // — and could not have. RN used to ship a LOCAL `useRenderTool` whose whole
      // body forwarded to react-core's `useFrontendTool`: core's OTHER hook,
      // wearing this one's name. Both names were present in that world and are
      // present in this one, so every presence check stayed green across the
      // deletion, having verified nothing about which hook a consumer gets.
      //
      // The difference is what a consumer is billed for. `useFrontendTool`
      // registers a tool AND its renderer, so the tool is advertised to the model
      // and callable by it; `useRenderTool` registers a renderer only. Under the
      // alias, `name: "*"` — the documented spelling of "render every tool call
      // nothing else claims" — registered a frontend tool literally named `*`,
      // schema-less and description-less. Core never OFFERED that one to the
      // model (`buildFrontendTools` filters the name out), but `*` is core's
      // catch-all HANDLER name, so the registration made a display-only wildcard
      // auto-answer every otherwise-unanswered tool call with an empty tool
      // result and request a follow-up turn
      // (src/hooks/__tests__/useRenderTool.test.tsx pins the behaviour; this pins
      // the wiring).
      //
      // PR #6533 converged both names onto react-core behind a temporary
      // routing shim, during which this half of the assertion could not be
      // identity; #6976 removed the shim and the test below is identity again.
      expect(
        mod.useFrontendTool,
        "`useFrontendTool` on the RN headless entry is NOT the binding from " +
          "@copilotkit/react-core/headless. RN must own no implementation of " +
          "it: re-export core's, or a local one will drift from it silently " +
          "under a name consumers already trust.",
      ).toBe(coreHeadless.useFrontendTool);
    });

    it("exports react-core's `useRenderTool` ITSELF, not an RN copy of it", () => {
      // The other half of the identity assertion above, and the one with the
      // history. RN's local `useRenderTool` forwarded its whole body to core's
      // `useFrontendTool`, so `name: "*"` registered a frontend tool literally
      // named `*` — core's catch-all HANDLER name — and a display-only wildcard
      // auto-answered every otherwise-unanswered tool call with an empty tool
      // result and asked for a follow-up turn. Both names were present through
      // that entire period, so every presence check above stayed green while
      // verifying nothing about which hook a consumer gets.
      //
      // Asserted TWICE, on purpose. Runtime identity is the claim; the source
      // check is what keeps the failure legible, because a local module that
      // re-exported core's binding unchanged today could grow a body tomorrow
      // and the runtime assertion would only start failing then. Requiring the
      // export to come straight from core's headless entry means an RN-local
      // module cannot be introduced under this name at all — which is the state
      // #6976 restored when it removed the compatibility shim.
      const source = fs.readFileSync(headlessEntry, "utf8");
      const from = reExportSpecifierOf(source, "useRenderTool");
      expect(
        from,
        'no `export { useRenderTool … } from "…"` found in src/headless.ts — ' +
          "this guard cannot tell what a consumer gets. If the export moved to " +
          "another form, teach `reExportSpecifierOf` about it.",
      ).not.toBeNull();
      expect(
        from,
        `src/headless.ts re-exports \`useRenderTool\` from "${from}". It must ` +
          `come straight from ${CORE_HEADLESS}: an RN-local module under this ` +
          `name is what shipped the \`*\`-named-tool bug, and the temporary ` +
          `shim that replaced it was removed in #6976.`,
      ).toBe(CORE_HEADLESS);

      expect(
        mod.useRenderTool,
        "`useRenderTool` on the RN headless entry is NOT the binding from " +
          `${CORE_HEADLESS}, though src/headless.ts re-exports it from there.`,
      ).toBe(coreHeadless.useRenderTool);
    });

    it("no longer exports the removed registry hook or its provider", () => {
      // Both removed (BREAKING). Asserted so neither creeps back as a shim:
      // useRenderToolRegistry cannot be honoured (core's renderers need
      // name/toolCallId, so a derived Map would silently change the call
      // signature), and RenderToolProvider has nothing left to provide now that
      // registration goes to CopilotKitCoreReact.renderToolCalls.
      for (const name of ["useRenderToolRegistry", "RenderToolProvider"]) {
        expect(mod, `must not export: ${name}`).not.toHaveProperty(name);
      }
    });

    it("does NOT re-export chat components or useAttachments from the headless entry", () => {
      for (const name of [
        "CopilotChat",
        "CopilotModal",
        "CopilotSidebar",
        "CopilotPopup",
        "useAttachments",
      ]) {
        expect(
          mod,
          `headless entry must not export: ${name}`,
        ).not.toHaveProperty(name);
      }
    });
  });

  // Applies to BOTH entries: the fat-entry ban is package-wide, unlike the
  // native-peer-dep ban above which only constrains the headless entry.
  it.each(ENTRIES)(
    "%s entry imports no react-core entry other than /headless and /context",
    (_label, entry) => {
      const { bareSpecs } = graphFor(entry);
      const offenders = [...bareSpecs].filter(
        (s) => isReactCoreSpec(s) && !ALLOWED_REACT_CORE_ENTRIES.includes(s),
      );
      expect(
        offenders,
        `must import only ${ALLOWED_REACT_CORE_ENTRIES.join(" or ")} — found: ${offenders.join(", ")}. ` +
          `Importing @copilotkit/react-core drags the shiki/mermaid/katex render stack into every RN bundle (#4893).`,
      ).toEqual([]);
    },
  );

  it.each(ENTRIES)(
    "%s entry imports none of the heavy render stack directly",
    (_label, entry) => {
      const { bareSpecs } = graphFor(entry);
      const leaked = FORBIDDEN_HEAVY.filter((dep) =>
        [...bareSpecs].some((s) => s === dep || s.startsWith(`${dep}/`)),
      );
      expect(leaked, `must not import: ${leaked.join(", ")}`).toEqual([]);
    },
  );
});

// ─── @copilotkit/react-native/generative-ui ─────────────────────────────────
// The generative UI entry is opt-in. It may use react-core's DOM-free generative
// UI entry, and nothing else of react-core but the shared context; and no other
// entry may reach it, so a consumer that does not use generative UI never
// bundles the surface engine or the catalog schemas of @copilotkit/shared.
// (zod is in the bundle of every entry regardless, but for different reasons:
// the headless and default entries load it through react-core's /headless,
// and this entry through react-core's /generative-ui/native, whose chat
// chunk imports it.)
const generativeUIEntry = path.join(srcDir, "generative-ui", "index.ts");
const GENERATIVE_UI_REACT_CORE_ENTRIES = [
  "@copilotkit/react-core/context",
  "@copilotkit/react-core/generative-ui/native",
];
const REQUIRED_GENERATIVE_UI_MODULES = [
  path.join("generative-ui", "index.ts"),
  path.join("generative-ui", "GenerativeUIProvider.tsx"),
  path.join("generative-ui", "GenerativeUIActivity.tsx"),
  path.join("generative-ui", "GenerativeUISurface.tsx"),
  path.join("generative-ui", "host.tsx"),
];

/**
 * Bare specifiers the generative UI graph MUST harvest. The same non-vacuity
 * floor as REQUIRED_HEADLESS_BARE: the react-core allow-list and the heavy/DOM
 * deny-lists below are all filters over `bareSpecs`, and every one of them
 * passes on an empty set. These two are the edges the entry exists for — the
 * catalog engine, and the host elements it renders into — so a walk that stops
 * harvesting them is a walk that is no longer checking anything.
 */
const REQUIRED_GENERATIVE_UI_BARE = [
  "@copilotkit/react-core/generative-ui/native",
  "react-native",
];

/**
 * Optional peers the generative UI entry is DELIBERATELY allowed to reach, on
 * top of guaranteedPackages(). None today.
 *
 * zod needs no entry: it is not a peer of this package. react-core,
 * `@copilotkit/core` and `@copilotkit/shared` list it in their own
 * `dependencies`, so the copy they load is theirs and asks the consumer for
 * nothing.
 *
 * Every optional peer stays unsanctioned: the chat/attachment natives
 * (`@gorhom/bottom-sheet`, `expo-document-picker`, `expo-file-system`) are
 * things a generative-UI-only consumer has not been told to install. Extend
 * this list only with a reason.
 */
const GENERATIVE_UI_ALLOWED_OPTIONAL_PEERS: string[] = [];

/**
 * Bare specifiers that ARE generative UI, matched exactly or as a subpath
 * prefix (never by substring, so an unrelated package whose name merely
 * contains "generative-ui" neither trips nor hides behind the check).
 *
 * DERIVED from the `exports` maps of every workspace package (and of every
 * `@copilotkit/*` dependency of this package, wherever it resolves): each
 * export subpath with a `generative-ui` segment. The hand-written list it
 * replaces missed `@copilotkit/shared/generative-ui` — the catalog schemas —
 * so the headless and default entries could have imported them unnoticed.
 *
 * GENERATIVE_UI_BARE_FLOOR is not the list. It is what the derivation must at
 * least find, so a derivation that silently finds nothing fails a test instead
 * of turning the ban off; and it is unioned in, so the ban holds meanwhile.
 */
const matchesBare = (spec: string, dep: string) =>
  spec === dep || spec.startsWith(`${dep}/`);

const GENERATIVE_UI_BARE_FLOOR = [
  "@copilotkit/react-native/generative-ui",
  "@copilotkit/react-core/generative-ui",
  "@copilotkit/core/generative-ui",
  "@copilotkit/shared/generative-ui",
];

const workspacePackagesDir = path.resolve(srcDir, "..", "..");

/**
 * name -> `exports` of every package the derivation reads. Collection-time
 * and must not throw (blind spot #4): failures are collected as problems.
 */
function scanExportsMaps(): {
  manifests: Map<string, unknown>;
  problems: string[];
} {
  const manifests = new Map<string, unknown>();
  const problems: string[] = [];
  const add = (file: string) => {
    try {
      const pkg = readManifest(file);
      if (pkg.name && !manifests.has(pkg.name))
        manifests.set(pkg.name, pkg.exports);
    } catch (err) {
      problems.push(`could not read ${file}: ${err}`);
    }
  };
  try {
    for (const dir of fs.readdirSync(workspacePackagesDir)) {
      const file = path.join(workspacePackagesDir, dir, "package.json");
      if (fs.existsSync(file)) add(file);
    }
    // Belt and braces for a dependency that is not (or no longer) a
    // workspace package: read the manifest the consumer would resolve.
    const own = readManifest(pkgJsonPath);
    const requireHere = createRequire(pkgJsonPath);
    for (const name of Object.keys({
      ...own.dependencies,
      ...own.peerDependencies,
    })) {
      if (!name.startsWith("@copilotkit/") || manifests.has(name)) continue;
      try {
        add(requireHere.resolve(`${name}/package.json`));
      } catch (err) {
        problems.push(`could not resolve ${name}/package.json: ${err}`);
      }
    }
  } catch (err) {
    problems.push(`could not scan ${workspacePackagesDir}: ${err}`);
  }
  return { manifests, problems };
}

/** The derivation: every export subpath with a `generative-ui` segment. */
function deriveGenerativeUIBare(manifests: Map<string, unknown>): string[] {
  const specs: string[] = [];
  for (const [name, exportsMap] of manifests) {
    if (!exportsMap || typeof exportsMap !== "object") continue;
    for (const key of Object.keys(exportsMap)) {
      if (hasGenerativeUISegment(key)) specs.push(`${name}${key.slice(1)}`);
    }
  }
  return specs.sort();
}

/**
 * The cross-check, deliberately looser than the derivation: every export
 * whose subpath OR target mentions "generative-ui" at all (an export renamed
 * to `./genui` but still pointing at `dist/generative-ui/…`, or a
 * `./generative-ui-extras` subpath), that the derivation does not cover.
 */
function uncoveredGenerativeUIExports(
  manifests: Map<string, unknown>,
): string[] {
  const derived = deriveGenerativeUIBare(manifests);
  const uncovered: string[] = [];
  for (const [name, exportsMap] of manifests) {
    if (!exportsMap || typeof exportsMap !== "object") continue;
    for (const [key, value] of Object.entries(exportsMap)) {
      const spec = `${name}${key.slice(1)}`;
      if (
        `${key} ${JSON.stringify(value)}`.includes("generative-ui") &&
        !derived.some((dep) => matchesBare(spec, dep))
      ) {
        uncovered.push(spec);
      }
    }
  }
  return uncovered.sort();
}

const EXPORTS_SCAN = scanExportsMaps();

const GENERATIVE_UI_BARE = [
  ...new Set([
    ...deriveGenerativeUIBare(EXPORTS_SCAN.manifests),
    ...GENERATIVE_UI_BARE_FLOOR,
  ]),
].sort();

describe("@copilotkit/react-native/generative-ui entry", () => {
  it("has an entry file", () => {
    expect(
      fs.existsSync(generativeUIEntry),
      `missing entry file: ${generativeUIEntry}`,
    ).toBe(true);
  });

  it("resolves every relative import and has no unanalyzable loader", () => {
    const { unresolved, opaque } = graphFor(generativeUIEntry);
    expect(
      unresolved,
      `unresolvable relative imports in the generative UI graph — the walker ` +
        `cannot see past these, so a forbidden import hidden behind one would ` +
        `read as clean: ${unresolved.join(", ")}`,
    ).toEqual([]);
    expect(
      opaque,
      `import()/require() with a non-literal specifier in the generative UI ` +
        `graph cannot be checked. Make it a literal: ${opaque.join(", ")}`,
    ).toEqual([]);
  });

  // The non-vacuity floor for every deny-list in this block.
  it("reaches the modules and bare imports it must reach", () => {
    const { seen, bareSpecs } = graphFor(generativeUIEntry);
    const reached = rel(seen);
    const missing = REQUIRED_GENERATIVE_UI_MODULES.filter(
      (m) => !reached.includes(m),
    );
    expect(
      missing,
      `the walk did not reach ${missing.join(", ")} — the checks below are ` +
        `then reasoning about a truncated graph. Reached: ${reached.join(", ")}`,
    ).toEqual([]);
    const missingBare = REQUIRED_GENERATIVE_UI_BARE.filter(
      (s) => !bareSpecs.has(s),
    );
    expect(
      missingBare,
      `no edge to ${missingBare.join(", ")} was harvested from the generative ` +
        `UI graph — the allow- and deny-lists below would pass on an empty set. ` +
        `Harvested: ${[...bareSpecs].sort().join(", ")}`,
    ).toEqual([]);
  });

  it("draws only on guaranteed packages, plus the optional peers it is allowed", () => {
    const { seen, bareSpecs } = graphFor(generativeUIEntry);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as PkgManifest;
    // An allowance for a package that is not even a declared optional peer is a
    // typo or a stale entry, and would quietly sanction nothing (or the wrong
    // thing); refuse it rather than trust it.
    const undeclared = GENERATIVE_UI_ALLOWED_OPTIONAL_PEERS.filter(
      (name) =>
        !pkg.peerDependencies?.[name] ||
        !pkg.peerDependenciesMeta?.[name]?.optional,
    );
    expect(
      undeclared,
      `GENERATIVE_UI_ALLOWED_OPTIONAL_PEERS names package(s) that are not ` +
        `optional peers in package.json: ${undeclared.join(", ")}`,
    ).toEqual([]);
    const allowed = new Set([
      ...guaranteedPackages(),
      ...GENERATIVE_UI_ALLOWED_OPTIONAL_PEERS,
    ]);
    const unsanctioned = [...bareSpecs]
      .filter((spec) => !allowed.has(packageNameOf(spec)))
      .sort();
    expect(
      unsanctioned,
      `the generative UI graph reaches package(s) a consumer of this entry is ` +
        `not guaranteed or told to have installed: ${unsanctioned.join(", ")}. ` +
        `Make it a dependency or non-optional peer in package.json, add it to ` +
        `GENERATIVE_UI_ALLOWED_OPTIONAL_PEERS with a reason, or drop the import. ` +
        `Graph: ${rel(seen).join(", ")}`,
    ).toEqual([]);
  });

  it("imports only react-core's /context and DOM-free /generative-ui/native", () => {
    const { bareSpecs } = graphFor(generativeUIEntry);
    const offenders = [...bareSpecs].filter(
      (s) =>
        isReactCoreSpec(s) && !GENERATIVE_UI_REACT_CORE_ENTRIES.includes(s),
    );
    expect(
      offenders,
      `must import only ${GENERATIVE_UI_REACT_CORE_ENTRIES.join(" or ")} — ` +
        `found: ${offenders.join(", ")}. /generative-ui carries the DOM ` +
        `standard catalog (react-dom portals, KaTeX, streamdown), and the root entry the ` +
        `chat render stack (#4893).`,
    ).toEqual([]);
  });

  it("pulls in neither the heavy render stack, the DOM, nor the chat/attachment peers", () => {
    const { bareSpecs, seen } = graphFor(generativeUIEntry);
    const banned = [...FORBIDDEN_HEAVY, ...FORBIDDEN_BARE, "react-dom"];
    const leaked = banned.filter((dep) =>
      [...bareSpecs].some((s) => matchesBare(s, dep)),
    );
    expect(
      leaked,
      `generative UI graph must not import: ${leaked.join(", ")}`,
    ).toEqual([]);
    // Base-name SUBSTRING matching, as in the headless block: a directory that
    // merely contains a forbidden name does not trip this, and a chat module
    // moved to another directory does not escape it — but any file whose base
    // name contains one (a `useCopilotChatState.ts`, say) does trip it.
    const chatModules = [...seen].filter((f) =>
      FORBIDDEN_LOCAL.some((name) =>
        path
          .basename(f)
          .replace(/\.tsx?$/, "")
          .includes(name),
      ),
    );
    expect(
      chatModules,
      `generative UI graph must not reach the chat UI / useAttachments ` +
        `modules: ${rel(chatModules).join(", ")}`,
    ).toEqual([]);
  });

  // The same ban as the headless block's. The generative UI provider registers
  // no tool (CopilotKitRuntime adds `render_ui` on the server), and the
  // `render_ui` renderer is written into CopilotKitCoreReact by react-core's
  // `GenerativeUIToolCallRenderer` (chat.tsx, via `setRenderToolCalls`), which
  // the provider mounts — in react-core, outside this walk. What this pins is
  // narrower: no RN module grows a registry (or a context to hold one) next to
  // CopilotKitCoreReact. Non-vacuity comes from REQUIRED_GENERATIVE_UI_MODULES.
  it("owns no tool/renderer registry of its own anywhere in the generative UI graph", () => {
    const { seen } = graphFor(generativeUIEntry);
    const offenders = registryOffenders(seen);
    expect(
      offenders,
      `module(s) in the generative UI graph touch registry internals ` +
        `directly:\n  ${offenders.join("\n  ")}\n` +
        `CopilotKitCoreReact is the single registry and this package must reach ` +
        `it only through react-core's hooks.`,
    ).toEqual([]);
  });

  it("applies the registry exemption when path.relative uses Windows separators", () => {
    // `path.relative` returns `\\`-separated paths on Windows, which the
    // POSIX-style exemption path never equalled, so the exemption silently did
    // not apply there and this graph's legitimate context failed the ban.
    const { seen } = graphFor(generativeUIEntry);
    const posixRelative = path.relative;
    const spy = vi
      .spyOn(path, "relative")
      .mockImplementation((from, to) =>
        posixRelative(from, to).split("/").join("\\"),
      );
    try {
      expect(registryOffenders(seen)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("has no stale registry exemption", () => {
    // Inside registryOffenders, a declaration that no longer matches is
    // already reported — but only for a file the walk reaches. A file that
    // moved or left the graph would make its exemption dead without a word,
    // so check reachability here, against every graph this file walks.
    const walked = new Set([
      ...graphFor(generativeUIEntry).seen,
      ...ENTRIES.flatMap(([, entry]) => [...graphFor(entry).seen]),
    ]);
    const stale = REGISTRY_API_EXEMPTIONS.filter(
      (e) => ![...walked].some((f) => srcRelative(f) === e.file),
    ).map((e) => `${e.file} ("${e.reason}")`);
    expect(
      stale,
      `stale registry exemption(s): the file is not in any walked graph ` +
        `(moved, renamed or no longer imported). Update or remove: ` +
        stale.join(", "),
    ).toEqual([]);
    const exemptedFiles = [...walked].filter((f) =>
      REGISTRY_API_EXEMPTIONS.some((e) => e.file === srcRelative(f)),
    );
    // Every exempted file is scanned on its own, so a declaration that no
    // longer matches exactly once is named here as stale, whichever graph it
    // is in.
    expect(
      registryOffenders(exemptedFiles).filter((o) =>
        o.includes("stale exemption"),
      ),
    ).toEqual([]);
  });

  it("reports an exemption that no longer matches as stale, naming its reason", () => {
    // Self-test of the mechanism above, against a deliberately stale copy of
    // the real exemption: the old code applied it as a silent no-op and then
    // blamed `createContext` for it.
    const file = path.join(srcDir, "generative-ui", "GenerativeUIProvider.tsx");
    const exemption = REGISTRY_API_EXEMPTIONS.find(
      (e) => e.file === "generative-ui/GenerativeUIProvider.tsx",
    )!;
    const stale: RegistryApiExemption[] = REGISTRY_API_EXEMPTIONS.map((e) =>
      e === exemption
        ? {
            ...e,
            declarations: [
              ...e.declarations,
              /()createContext<boolean>\(false\);/,
            ],
          }
        : e,
    );
    const offenders = registryOffenders([file], stale);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("stale exemption");
    expect(offenders[0]).toContain(exemption.reason);
  });

  it("derives the generative UI deny-list from every generative UI export", () => {
    expect(
      EXPORTS_SCAN.problems,
      `could not read every exports map the deny-list is derived from:\n  ` +
        EXPORTS_SCAN.problems.join("\n  "),
    ).toEqual([]);
    const derived = deriveGenerativeUIBare(EXPORTS_SCAN.manifests);
    const missingFloor = GENERATIVE_UI_BARE_FLOOR.filter(
      (s) => !derived.includes(s),
    );
    expect(
      missingFloor,
      `the exports-map derivation no longer finds ${missingFloor.join(", ")} — ` +
        `either the export was renamed or removed (update ` +
        `GENERATIVE_UI_BARE_FLOOR) or the derivation is broken. Derived: ` +
        derived.join(", "),
    ).toEqual([]);
    const uncovered = uncoveredGenerativeUIExports(EXPORTS_SCAN.manifests);
    expect(
      uncovered,
      `export(s) that mention generative-ui but are not covered by the ` +
        `derived deny-list: ${uncovered.join(", ")}. Give the export a ` +
        `\`generative-ui\` path segment, or teach deriveGenerativeUIBare about ` +
        `it, so the other entries are kept from reaching it.`,
    ).toEqual([]);
  });

  it("the cross-check catches a generative UI export the derivation misses", () => {
    const manifests = new Map<string, unknown>([
      [
        "@copilotkit/example",
        {
          "./generative-ui": "./dist/generative-ui.mjs",
          "./genui": { import: "./dist/generative-ui/extra.mjs" },
          "./generative-ui-extras": "./dist/extras.mjs",
          "./other": "./dist/other.mjs",
        },
      ],
    ]);
    expect(deriveGenerativeUIBare(manifests)).toEqual([
      "@copilotkit/example/generative-ui",
    ]);
    expect(uncoveredGenerativeUIExports(manifests)).toEqual([
      "@copilotkit/example/generative-ui-extras",
      "@copilotkit/example/genui",
    ]);
  });

  it.each(ENTRIES)(
    "the %s entry does not reach generative UI",
    (_label, entry) => {
      const { seen, bareSpecs } = graphFor(entry);
      const modules = rel(seen).filter((f) =>
        f.startsWith(`generative-ui${path.sep}`),
      );
      expect(
        modules,
        `this entry reaches the opt-in generative UI modules: ` +
          `${modules.join(", ")}. A consumer who never imports ` +
          `@copilotkit/react-native/generative-ui must not bundle them.`,
      ).toEqual([]);
      const specs = [...bareSpecs]
        .filter((s) => GENERATIVE_UI_BARE.some((dep) => matchesBare(s, dep)))
        .sort();
      expect(
        specs,
        `this entry imports generative UI: ${specs.join(", ")}. The surface ` +
          `engine and its catalog schemas belong only behind the opt-in ` +
          `@copilotkit/react-native/generative-ui entry.`,
      ).toEqual([]);
    },
  );
});

// ─── react-core dist: one copy of each generative UI context ────────────────
// The RN generative UI entry works only if the context its provider SETS and
// the context its surfaces READ are the same object. GenerativeUIProvider puts
// the runtime into react-core's `GenerativeUIRuntimeContext` and the host into
// `GenerativeUIHostContext`, both imported from `/generative-ui/native`;
// react-core's own hooks and SurfaceView read them from whatever chunk they
// were bundled into. react-core's tsdown config keeps `/generative-ui/native`
// in the main build precisely so that every entry shares ONE chunk carrying
// these modules. If a config change inlined a second copy (native moved to its
// own build, a chunking option), every typecheck and source-level test would
// stay green — vitest and tsc see one source module — and a surface would
// silently never see its runtime. react-core's context-singleton-preflight only
// covers src/context.ts, so this checks the generative UI context modules in
// the BUILT dist, by the `//#region <src path>` banner tsdown writes for every
// inlined module (the same marker that preflight relies on).
const reactCoreDir = (() => {
  try {
    return path.dirname(
      createRequire(pkgJsonPath).resolve("@copilotkit/react-core/package.json"),
    );
  } catch {
    return path.join(workspacePackagesDir, "react-core");
  }
})();

/** Context modules that MUST be bundled exactly once per format. A floor. */
const REQUIRED_SINGLE_CONTEXT_MODULES = [
  "src/generative-ui/runtime-context.ts",
  "src/generative-ui/host.tsx",
];

/** Every file under `dir` (recursively) whose name matches `re`. */
function filesUnder(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") out.push(...filesUnder(full, re));
    } else if (re.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("@copilotkit/react-core dist: one copy of each generative UI context", () => {
  it("bundles every generative UI context module at most once per format", () => {
    const distDir = path.join(reactCoreDir, "dist");
    expect(
      fs.existsSync(distDir),
      `${distDir} does not exist — build @copilotkit/react-core first`,
    ).toBe(true);
    // Derived from source: every generative UI module that calls
    // createContext, so a new context module is covered without listing it.
    const contextModules = filesUnder(
      path.join(reactCoreDir, "src", "generative-ui"),
      /\.tsx?$/,
    )
      .filter((f) =>
        /\bcreateContext\s*[<(]/.test(
          stripComments(fs.readFileSync(f, "utf8")),
        ),
      )
      .map((f) => path.relative(reactCoreDir, f).split(path.sep).join("/"))
      .sort();
    const missingFloor = REQUIRED_SINGLE_CONTEXT_MODULES.filter(
      (m) => !contextModules.includes(m),
    );
    expect(
      missingFloor,
      `no createContext found in ${missingFloor.join(", ")} — the source scan ` +
        `is broken or the module moved; update REQUIRED_SINGLE_CONTEXT_MODULES`,
    ).toEqual([]);

    // UMD bundles are self-contained by design (as in react-core's own
    // preflight), so only the ESM and CJS module graphs are checked.
    const bundles = filesUnder(distDir, /\.(?:mjs|cjs)$/).map((f) => ({
      file: path.relative(distDir, f).split(path.sep).join("/"),
      code: fs.readFileSync(f, "utf8"),
    }));
    const problems: string[] = [];
    for (const contextModule of contextModules) {
      const marker = `//#region ${contextModule}\n`;
      for (const format of ["mjs", "cjs"]) {
        const carriers = bundles
          .filter(
            (b) => b.file.endsWith(`.${format}`) && b.code.includes(marker),
          )
          .map((b) => b.file);
        const required =
          REQUIRED_SINGLE_CONTEXT_MODULES.includes(contextModule);
        if (carriers.length > 1 || (required && carriers.length !== 1)) {
          problems.push(
            `${contextModule} is in ${carriers.length} .${format} file(s)` +
              (carriers.length ? `: ${carriers.join(", ")}` : "") +
              (required && !carriers.length
                ? " (expected exactly 1 — or tsdown's region banner changed, " +
                  "and this check can no longer see duplicates)"
                : ""),
          );
        }
      }
    }
    expect(
      problems,
      `a generative UI context module is bundled more than once in ` +
        `@copilotkit/react-core's dist, so a provider and the components ` +
        `below it can hold different context objects:\n  ` +
        problems.join("\n  "),
    ).toEqual([]);
  });
});

/**
 * The first module a source file loads at runtime, in source order: type-only
 * imports and re-exports are erased, so they are skipped. Null if it loads none.
 */
function firstRuntimeSpecifier(code: string): string | null {
  const stripped = stripComments(code);
  const patterns = [
    /\b(import)\s+(type\s+)?[^;"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
    /\b(import)\s*()["'`]([^"'`]+)["'`]/g,
    /\b(export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
  ];
  let first: { index: number; spec: string } | null = null;
  for (const re of patterns) {
    for (const m of stripped.matchAll(re)) {
      if (m[2]) continue;
      if (!first || m.index! < first.index) {
        first = { index: m.index!, spec: m[3]! };
      }
    }
  }
  return first?.spec ?? null;
}

/** `src/polyfills.ts` and the five modules under `src/polyfills/`. */
const polyfillsBarrel = path.join(srcDir, "polyfills.ts");
const isPolyfillModule = (file: string) =>
  file === polyfillsBarrel ||
  path.dirname(file) === path.join(srcDir, "polyfills");

/**
 * Every published entry that loads CopilotKit code. The polyfill subpaths are
 * the polyfills themselves; everything else reaches @copilotkit/core or
 * @ag-ui/client, which need ReadableStream / TextEncoder / crypto at load time
 * on Hermes.
 */
const CODE_ENTRIES: [label: string, entry: string][] = [
  ...ENTRIES.filter(([, entry]) => !isPolyfillModule(entry)),
  ...DERIVED_ENTRIES.generativeUI.map(
    (entry) =>
      ["@copilotkit/react-native/generative-ui", entry] as [string, string],
  ),
];

/**
 * A glob from package.json `sideEffects` -> a RegExp over `./`-relative paths.
 * Only the two wildcards this package uses: `**` (any depth) and `*`.
 */
const regexLiteral = (part: string) =>
  part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

function sideEffectsGlob(glob: string): RegExp {
  const body = glob
    .split("**/")
    .map((seg) =>
      seg
        .split("**")
        .map((part) => part.split("*").map(regexLiteral).join("[^/]*"))
        .join(".*"),
    )
    .join("(?:.*/)?");
  return new RegExp(`^${body}$`);
}

describe("every published entry installs the polyfills before CopilotKit loads", () => {
  it("covers the root, /headless and /generative-ui entries at least", () => {
    const walked = CODE_ENTRIES.map(([, entry]) => entry);
    const floor = [
      indexEntry,
      headlessEntry,
      path.join(srcDir, "generative-ui", "index.ts"),
    ];
    expect(
      floor.filter((e) => !walked.includes(e)),
      `entries missing from the polyfill-order check; derived: ${rel(walked).join(", ")}`,
    ).toEqual([]);
  });

  // An app that imports this entry BEFORE any other @copilotkit/react-native
  // entry must still get the polyfills first: on Hermes, @copilotkit/core and
  // @ag-ui/client fail at load time without them, with a ReferenceError that
  // says nothing about import order. Being imported first in the file is what
  // makes the bundler emit it as the built entry's first statement, which
  // scripts/verify-polyfill-barrel.mjs then checks in dist/.
  it.each(CODE_ENTRIES)(
    "%s imports ./polyfills as its first runtime import",
    (_label, entry) => {
      const first = firstRuntimeSpecifier(fs.readFileSync(entry, "utf8"));
      expect(
        first ? resolveLocal(entry, first) : null,
        `${srcRelative(entry)} must start with \`import "${path
          .relative(path.dirname(entry), polyfillsBarrel)
          .replace(/\\/g, "/")
          .replace(/\.ts$/, "")
          .replace(/^(?!\.)/, "./")}";\` — its first runtime import is ` +
          `${JSON.stringify(first)}`,
      ).toBe(polyfillsBarrel);
    },
  );

  // A `sideEffects` list that misses an entry tells the consumer's bundler the
  // bare `import "./polyfills"` in it can be dropped.
  it.each(CODE_ENTRIES)(
    "%s is declared in package.json sideEffects, as source and as build output",
    (label, entry) => {
      const manifest = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
        sideEffects?: unknown;
        exports?: Record<string, unknown>;
      };
      const globs = Array.isArray(manifest.sideEffects)
        ? manifest.sideEffects.map((g) => sideEffectsGlob(String(g)))
        : [];
      const key = `.${label.slice("@copilotkit/react-native".length)}`;
      const exported = manifest.exports?.[key] as
        | Record<string, string>
        | undefined;
      const files = [
        `./${path.relative(path.dirname(pkgJsonPath), entry).replace(/\\/g, "/")}`,
        ...Object.values(exported ?? {}),
      ];
      expect(files.length, `no exports entry for ${key}`).toBeGreaterThan(1);
      expect(
        files.filter((file) => !globs.some((re) => re.test(file))),
        `not matched by any package.json sideEffects glob`,
      ).toEqual([]);
    },
  );
});
