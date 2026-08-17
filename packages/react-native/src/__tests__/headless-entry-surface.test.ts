import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
// Type-only, so it is erased and does NOT statically pull the entry this file
// deliberately loads at runtime (and is not part of the walked graph either —
// the walk starts at src/headless.ts / src/index.ts, not at this test).
import type * as HeadlessEntry from "../headless";
// Same reason, and additionally: the identity assertion below needs the module
// this entry re-exports FROM, to compare bindings rather than merely count them.
import type * as CoreHeadlessEntry from "@copilotkit/react-core/v2/headless";

/**
 * Guards the `@copilotkit/react-native/headless` entry (src/headless.ts).
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
 * Mirrors the export-surface guard added for @copilotkit/react-core/v2/headless
 * (PR #5883).
 *
 * ─── Why the walker looks the way it does ──────────────────────────────────
 * A guard that under-reports is worse than no guard, because it is trusted. The
 * first version of this file had four blind spots, each of which let a REAL
 * violation through (or flagged a non-violation), so the walker below is written
 * to close them and each is covered by a test:
 *
 *  1. It only saw `import … from "x"`. A lazy optional-peer
 *     `require("@copilotkit/react-core/v2")` or `await import(…)` — which Metro
 *     follows and bundles just the same — was invisible. Now static, bare
 *     side-effect, dynamic `import()` and `require()` are all extracted, and a
 *     loader whose argument is NOT a literal is reported as unanalyzable rather
 *     than ignored.
 *  2. It matched raw text, so doc comments counted as imports. That was not
 *     hypothetical: it was harvesting EIGHT specifiers (`@copilotkit/react-native`,
 *     `…/headless`, `…/polyfills` and its five subpaths) that NO source file
 *     imports (half the reported bare-specifier set), purely from JSDoc
 *     examples. In the other direction, a "don't do this: import from
 *     @copilotkit/react-core/v2" counter-example written in a doc comment failed
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

// ─── #4893 bundle guard ──────────────────────────────────────────────────────
// @copilotkit/react-core/v2 (the "fat" entry) re-exports from a monolithic chunk
// that pulls the chat-message rendering stack: streamdown -> shiki (~5.5 MB of
// grammars + themes), plus mermaid, cytoscape and katex. Metro does not
// tree-shake, so ONE import of that specifier from anywhere in this package puts
// all of it in every consumer's app bundle (issue #4893). PR #5883 moved the lean
// hooks into /v2/headless precisely so this package never needs the fat entry.
const ALLOWED_REACT_CORE_ENTRIES = [
  "@copilotkit/react-core/v2/headless",
  "@copilotkit/react-core/v2/context",
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
  "@copilotkit/a2ui-renderer",
  "@copilotkit/web-inspector",
  "@copilotkit/runtime-client-gql",
];

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
const REQUIRED_HEADLESS_BARE = ["@copilotkit/react-core/v2/headless"];

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
 * (`@gorhom/bottom-sheet`, `expo-*`, `react-native-streamdown`, `zod`), any
 * brand-new third-party edge, and any Node builtin (which RN has no business
 * reaching). This package's OWN name is deliberately absent, which is what keeps
 * this test doubling as the comment-stripping regression: the eight phantom
 * `@copilotkit/react-native…` specifiers that JSDoc examples used to harvest are
 * all self-references, so if `stripComments` regresses they fail here.
 *
 * What this set does NOT police is WHICH ENTRY of an allowed package is imported:
 * `@copilotkit/react-core` is a legitimate dependency, so the fat
 * `@copilotkit/react-core/v2` passes here and is caught by the dedicated
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

const ENTRIES: [label: string, entry: string][] = [
  ["headless", headlessEntry],
  ["default barrel", indexEntry],
];

describe("@copilotkit/react-native/headless entry", () => {
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

  /**
   * The four checks below need the entry EVALUATED, not just read: they assert
   * that the named exports exist as runtime values (a re-export of a name that
   * no longer exists is a runtime hole a static read cannot see). So the import
   * stays — but it is paid exactly once, in a hook, rather than being raced by
   * four tests against the default per-test budget.
   *
   * Why the budget below is what it is. Nothing here is hung or polling — the
   * cost is a ONE-TIME module-graph load (resolve + transform + evaluate), paid
   * per worker with no persistent transform cache, and it is the VARIANCE rather
   * than the mean that broke the 5s default:
   *
   *   - vitest.config.mjs sets `server.deps.inline: [/@copilotkit/]`, so the
   *     workspace dists this entry pulls are transformed rather than loaded
   *     natively: ~283 KB (core ~218 KB, react-core v2/headless ~55 KB, plus
   *     v2/context and shared), on top of the 11 RN source modules.
   *   - Measured on one dev machine: ~0.9–1.8s inside the full 22-file suite
   *     (n=8), ~0.7–1.1s for this file alone (n=8) — but 4568ms on the run
   *     straight after a cold `nx build`, i.e. 91% of the 5s budget, and the
   *     4 independent agents who hit this hit it as an outright timeout. Bare
   *     Node `import()` of the equivalent prebuilt dist is 461ms, so the spread
   *     is resolve/transform and page-cache-cold I/O, both load-sensitive.
   *
   * So the budget is a CEILING for a cold, loaded or slower (CI) machine, NOT an
   * expected duration: the happy path stays ~1s and every test below reports
   * ~0ms. A genuinely hung import still fails, just not spuriously. Lowering it
   * re-introduces the flake; lowering the COST would mean not inlining
   * `@copilotkit/core` for this suite, which is a shared-config change affecting
   * all 22 test files rather than something this file can do.
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
      // Both loads live in the ONE budgeted hook. core's /v2/headless is already
      // inside this entry's own graph, so importing it here is a module-cache
      // hit rather than a second traversal.
      [mod, coreHeadless] = await Promise.all([
        import("../headless"),
        import("@copilotkit/react-core/v2/headless"),
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

    it("exports react-core's tool hooks THEMSELVES, not RN copies of them", () => {
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
      // schema-less and description-less, and offered it to the model
      // (src/hooks/__tests__/useRenderTool.test.tsx pins the behaviour; this pins
      // the wiring).
      for (const name of ["useRenderTool", "useFrontendTool"] as const) {
        expect(
          mod[name],
          `\`${name}\` on the RN headless entry is NOT the binding from ` +
            `@copilotkit/react-core/v2/headless. RN must own no implementation of ` +
            `either hook: re-export core's, or a local one will drift from it ` +
            `silently under a name consumers already trust.`,
        ).toBe(coreHeadless[name]);
      }
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
    "%s entry imports no react-core entry other than /v2/headless and /v2/context",
    (_label, entry) => {
      const { bareSpecs } = graphFor(entry);
      const offenders = [...bareSpecs].filter(
        (s) =>
          s.startsWith("@copilotkit/react-core") &&
          !ALLOWED_REACT_CORE_ENTRIES.includes(s),
      );
      expect(
        offenders,
        `must import only ${ALLOWED_REACT_CORE_ENTRIES.join(" or ")} — found: ${offenders.join(", ")}. ` +
          `Importing @copilotkit/react-core/v2 drags the shiki/mermaid/katex render stack into every RN bundle (#4893).`,
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
