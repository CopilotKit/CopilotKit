// Tests for the hard-fail CI gate in scripts/assert-headless-purity.mjs (#4893
// and the generative-ui/native contract). The gate must follow every edge out of
// an entry, so a violation behind a relative chunk or an external package is seen,
// and must read the graph rather than raw text, so a banned token in a comment
// does not fail CI on code that links nothing.
//
// A guard is only worth having if its FAILURE mode is covered, so each test here
// asserts one direction of that: a real violation must be seen, and a mention must
// not be mistaken for one.
//
// Standalone Node test (not vitest), matching measure-copilotchat.test.mjs: the
// module under test drives esbuild, which trips vitest's jsdom env probe, and the
// package-wide vitest setup uses jsdom-only globals.
//
// Invoked from package.json `test:scripts` and the chained `test` command.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  assertEntryPurity,
  classStaticBlocks,
  collectModuleGraph,
  contractFor,
  forbiddenHits,
  isEntrypoint,
  isForbiddenPackage,
  maskNonCode,
  packageNameFor,
  scanSource,
  staticBlocksIn,
  unanalyzableLoaderCalls,
} from "../assert-headless-purity.mjs";
import * as gate from "../assert-headless-purity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "../..");
const fixture = (name) => path.join(here, "fixtures", name);
const repoRoot = path.resolve(pkgRoot, "../..");
const scriptFile = path.resolve(here, "../assert-headless-purity.mjs");

/**
 * Runs `run(root)` over a fresh temp directory and always removes it. The `try`
 * opens right after mkdtemp, so a throw while the caller builds files or links
 * inside `root` cannot leak the directory.
 */
const withScratch = async (prefix, run) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  try {
    return await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** Writes { relativePath: contents } under `root`, creating directories. */
const writeTree = (root, files) => {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof contents === "string" ? contents : JSON.stringify(contents),
    );
  }
};

/** A react-core subpath specifier, for the import-reader fixtures. */
const coreEntry = (name) => `@copilotkit/react-core/${name}`;

/**
 * Every `@copilotkit/react-core` entry that the source files under `dir` load at
 * runtime, sorted. Reads quoted specifiers after `from`, after a bare `import`
 * (side effect), and inside `import(…)` and `require(…)`, in .js/.jsx/.mjs/.cjs/
 * .ts/.tsx files. Comments and strings are masked first, so a mention there is
 * not an import. Skips `import type`/`export type`, declaration files, and the
 * `__tests__` and `__mocks__` directories: none of those reaches an app bundle.
 *
 * @param {string} dir
 * @returns {string[]}
 */
const reactCoreEntriesImportedBy = (dir) => {
  const imported = new Set();
  const statementStart = /(?<![.\w$])(?:import|export)(?![\w$])/g;
  const typeOnly = /^\s+type\s+(?!from(?![\w$]))[\w${*]/;
  const collect = (code) => {
    const { masked, literals } = scanSource(code);
    for (const literal of literals) {
      const specifier = code.slice(literal.start + 1, literal.end - 1);
      if (!/^@copilotkit\/react-core(?:\/|$)/.test(specifier)) continue;
      const before = masked.slice(0, literal.start);
      if (/(?<![.\w$])(?:import|require)\s*\(\s*$/.test(before)) {
        imported.add(specifier);
      } else if (/(?<![.\w$])(?:from|import)\s*$/.test(before)) {
        const starts = [...before.matchAll(statementStart)];
        const last = starts[starts.length - 1];
        const head = last ? before.slice(last.index + last[0].length) : "";
        if (!typeOnly.test(head)) imported.add(specifier);
      }
    }
  };
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "__mocks__") {
          walk(full);
        }
      } else if (
        /\.(?:[cm]?js|jsx|tsx?)$/.test(entry.name) &&
        !/\.d\.[cm]?ts$/.test(entry.name)
      ) {
        collect(fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(dir);
  return [...imported].sort();
};

/** runGate's closing advice for targets it could not scan, exactly. */
const SCAN_ADVICE = (list, many) =>
  `\n${list} could not be scanned, so the gate cannot say whether ` +
  `${many ? "they meet their" : "it meets its"} contract. Run ` +
  "`nx run @copilotkit/react-core:build` if dist is missing; otherwise fix " +
  "the edge named above.";

/**
 * A scratch package whose dependency `depx` disables one of its own files
 * through the `browser` field. esbuild (platform "browser") keys that file in
 * the metafile as `(disabled):…/node_modules/depx/node.js` and bundles an empty
 * stub in its place. The disabled file on disk holds a static block, which must
 * NOT be reported: it never ships.
 */
const DISABLED_DEP_TREE = {
  "node_modules/depx/package.json": {
    name: "depx",
    version: "1.0.0",
    main: "index.js",
    browser: { "./node.js": false },
  },
  "node_modules/depx/index.js": 'module.exports = require("./node.js");\n',
  "node_modules/depx/node.js":
    "class NodeOnly {\n  static {\n    this.fs = 1;\n  }\n}\nmodule.exports = NodeOnly;\n",
  "entry.mjs": 'import depx from "depx";\nexport default depx;\n',
};

// `zod` stands in for a forbidden dep: it is a dev and peer dependency of this
// package, so it is installed and resolves through node_modules exactly as
// shiki/streamdown would, without making the test bundle 5.5 MB of grammars.
const STAND_IN = ["zod"];
// The gate's real list, used to prove the no-false-positive direction.
const REAL_FORBIDDEN = ["shiki", "mermaid", "cytoscape", "katex", "streamdown"];

describe("packageNameFor", () => {
  it("reads through pnpm's nested node_modules to the real package name", () => {
    assert.equal(
      packageNameFor(
        "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/lib/index.mjs",
      ),
      "zod",
    );
  });

  it("keeps the scope of a scoped package", () => {
    assert.equal(
      packageNameFor(
        "../../node_modules/.pnpm/@shikijs+core@1.0.0/node_modules/@shikijs/core/dist/index.mjs",
      ),
      "@shikijs/core",
    );
  });

  it("returns null for first-party files", () => {
    assert.equal(packageNameFor("dist/headless.mjs"), null);
    // The old guard's substring match would have flagged this file. A path is
    // not a dependency.
    assert.equal(packageNameFor("src/katex-notes.ts"), null);
  });
});

describe("isForbiddenPackage", () => {
  it("matches the dep itself and the family it ships as", () => {
    assert.ok(isForbiddenPackage("shiki", "shiki"));
    assert.ok(isForbiddenPackage("@shikijs/langs", "shiki"));
    assert.ok(isForbiddenPackage("cytoscape-fcose", "cytoscape"));
  });

  it("does not match an unrelated package that merely starts the same way", () => {
    assert.ok(!isForbiddenPackage("shikimori", "shiki"));
    assert.ok(!isForbiddenPackage("react-katexish", "katex"));
  });

  it("matches exactly the Lit packages for `lit`", () => {
    for (const name of [
      "lit",
      "lit-html",
      "lit-element",
      "@lit/reactive-element",
      "@lit/context",
      "@lit-labs/ssr-dom-shim",
    ]) {
      assert.ok(isForbiddenPackage(name, "lit"), name);
    }
  });

  it("matches react-dom and its subpaths exactly, not packages that share its prefix", () => {
    assert.ok(isForbiddenPackage("react-dom", "react-dom"));
    assert.ok(isForbiddenPackage("react-dom/client", "react-dom"));
    for (const name of [
      "react-dom-confetti",
      "react-domify",
      "@react-domx/y",
      "@react-dom/x",
    ]) {
      assert.ok(!isForbiddenPackage(name, "react-dom"), name);
    }
  });

  it("does not match a package that only shares Lit's first letters", () => {
    for (const name of [
      "@litert/x",
      "@lit-protocol/x",
      "@litejs/x",
      "@lite/x",
      "lit-protocol",
      "literal",
    ]) {
      assert.ok(!isForbiddenPackage(name, "lit"), name);
    }
  });
});

describe("forbiddenHits", () => {
  it("flags a dep resolved into the graph", () => {
    const hits = forbiddenHits({
      inputs: [
        "dist/headless.mjs",
        "../../node_modules/.pnpm/streamdown@1.3.0/node_modules/streamdown/dist/index.js",
      ],
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(hits, [{ dep: "streamdown", via: ["streamdown"] }]);
  });

  it("does not flag a first-party path that merely contains the token", () => {
    assert.deepEqual(
      forbiddenHits({
        inputs: ["dist/headless.mjs", "src/lib/katex-helpers.ts"],
        forbidden: REAL_FORBIDDEN,
      }),
      [],
    );
  });

  it("flags a dep left EXTERNAL, which resolves to no graph input at all", () => {
    const hits = forbiddenHits({
      inputs: ["dist/headless.mjs"],
      externalSpecifiers: ["react", "streamdown/lib/lazy"],
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(hits, [{ dep: "streamdown", via: ["streamdown"] }]);
  });
});

describe("maskNonCode / scanSource", () => {
  it("blanks comments, strings, templates and regexes without moving an offset", () => {
    const code = [
      'const a = "// not a comment";',
      "// a comment",
      "const b = /re\\/gex/;",
      "const c = 1;",
    ].join("\n");
    const masked = maskNonCode(code);
    assert.equal(masked.length, code.length, "offsets must still line up");
    assert.equal(masked.split("\n").length, code.split("\n").length);
    // Code survives; every literal and comment is blanked.
    assert.ok(masked.includes("const a = "));
    assert.ok(masked.includes("const c = 1;"));
    assert.ok(!masked.includes("not a comment"));
    assert.ok(!masked.includes("a comment"));
    assert.ok(!masked.includes("gex"));
  });

  it("consumes a `//` inside a string as part of the string, not as a comment", () => {
    // If the comment branch won, `const b` would be blanked too.
    const masked = maskNonCode('const a = "// x";\nconst b = 2;');
    assert.ok(masked.includes("const b = 2;"));
  });

  it("consumes a `/*` inside a string, so no block comment is opened", () => {
    // If it did, everything up to the next `*/` would be blanked, hiding the
    // code in between.
    const masked = maskNonCode(
      'const a = "/* not a comment";\nconst b = 2;\nconst c = 3;',
    );
    assert.ok(masked.includes("const b = 2;"));
    assert.ok(masked.includes("const c = 3;"));
  });

  it("does not let a regex literal containing // blank the rest of its line", () => {
    // A false NEGATIVE otherwise: the `//` at the end of `/https:\/\//` would read
    // as a comment start and hide the real call after it.
    const masked = maskNonCode(
      "const re = /https:\\/\\//; const load = (n) => import(n);",
    );
    assert.ok(masked.includes("import("));
    assert.ok(!masked.includes("https"));
  });

  it("keeps a template's ${…} interpolation as CODE while blanking its text", () => {
    const { masked, literals } = scanSource("const t = `a ${import(n)} b`;");
    assert.ok(masked.includes("import(n)"), "the interpolation is real code");
    assert.ok(!masked.includes("a "), "the literal chunks are blanked");
    assert.equal(literals.length, 1);
    assert.equal(literals[0].interpolated, true);
    assert.equal(literals[0].terminated, true);
  });

  it("cannot be swallowed by an apostrophe in prose", () => {
    const masked = maskNonCode(
      "// it doesn't matter\nconst load = (n) => import(n);",
    );
    assert.ok(masked.includes("import(n)"));
  });

  it("marks a literal the file never closes as unterminated", () => {
    const { literals } = scanSource('const a = "never closed');
    assert.equal(literals.length, 1);
    assert.equal(literals[0].terminated, false);
  });
});

// Both directions of the loader-call detector. Each case in the two blocks below
// is a wrong verdict a regex-only detector gives: leaving string, template and
// regex literals intact (so import-shaped TEXT fails CI), matching a bare
// `\brequire` / `\bimport` (so member calls fail and rolldown's `__require`
// escapes), or classifying an argument as static from its FIRST CHARACTER alone
// (so anything merely starting with a quote reads as clean while hiding its
// target).
describe("unanalyzableLoaderCalls — must NOT report (false-positive direction)", () => {
  it("import-shaped text inside a string literal", () => {
    assert.deepEqual(
      unanalyzableLoaderCalls(
        'export function f() {\n  throw new Error("use require(path) instead");\n}',
      ),
      [],
    );
  });

  it("import-shaped text inside a template literal", () => {
    assert.deepEqual(
      unanalyzableLoaderCalls("export const doc = (x) => `import(${x})`;"),
      [],
    );
  });

  it("import-shaped text inside a regex literal", () => {
    assert.deepEqual(
      unanalyzableLoaderCalls("export const e = /import\\(x\\)/;"),
      [],
    );
  });

  it("member calls, including one split across lines", () => {
    assert.deepEqual(
      unanalyzableLoaderCalls(
        [
          "export const a = (o, y) => o.import(y);",
          "export const b = (m, x) => m.require(x);",
          "export const c = (m, x) => m?.require(x);",
          "export const d = (m, x) => m",
          "  .import(x);",
        ].join("\n"),
      ),
      [],
    );
  });

  it("an identifier that merely ends with a loader word", () => {
    assert.deepEqual(
      unanalyzableLoaderCalls("export const h = (x) => myrequire(x);"),
      [],
    );
  });

  it("complete static literals, including a non-interpolated template and import attributes", () => {
    assert.deepEqual(
      unanalyzableLoaderCalls(
        [
          'import "streamdown";',
          'export const a = () => import("./m.mjs");',
          "export const b = () => import(`./m.mjs`);",
          'export const c = () => require.resolve("./m.mjs");',
          'export const d = () => import( "./m.mjs" );',
          'export const e = () => import("./m.json", { with: { type: "json" } });',
          "// const z = await import(name);",
          "/* import(other) */",
        ].join("\n"),
      ),
      [],
    );
  });
});

describe("unanalyzableLoaderCalls — MUST report (false-negative direction)", () => {
  /** @param {string} code @param {RegExp} pattern */
  const reportsOne = (code, pattern) => {
    const calls = unanalyzableLoaderCalls(code);
    assert.equal(
      calls.length,
      1,
      `expected exactly one report, got ${calls.length}: ${JSON.stringify(calls)}`,
    );
    assert.match(calls[0], pattern);
  };

  it("a plain variable argument", () => {
    reportsOne("export const f = (n) => import(n);", /import\(n\)/);
  });

  it("an INTERPOLATED template argument (starts with a quote, hides its target)", () => {
    reportsOne(
      "export const load = (n) => import(`stream${n}`);",
      /import\(`stream\$\{n\}`\)/,
    );
  });

  it("an interpolated path to the fat entry", () => {
    reportsOne(
      'const base = ".";\nexport const load = () => import(`${base}/v2/index.mjs`);',
      /v2\/index\.mjs/,
    );
  });

  it("a CONCATENATED argument (starts with a quote, hides its target)", () => {
    reportsOne(
      'export const load = (n) => import("zo" + n);',
      /import\("zo" \+ n\)/,
    );
  });

  it("rolldown's __require, which a \\brequire pattern cannot match", () => {
    reportsOne(
      "export const load = (name) => __require(name);",
      /__require\(name\)/,
    );
  });

  it("require.resolve with a variable", () => {
    reportsOne(
      "export const load = (n) => require.resolve(n);",
      /require\.resolve\(n\)/,
    );
  });

  it("a real dynamic call on the same line as a regex containing //", () => {
    reportsOne(
      "export const re = /https:\\/\\//; export const load = (n) => import(n);",
      /import\(n\)/,
    );
  });

  it("a call whose parenthesis is never closed", () => {
    reportsOne("export const load = (n) => import(n", /import\(n/);
  });

  it("a call whose argument sits inside an unterminated string", () => {
    reportsOne(
      'export const load = () => import("./m.mjs',
      /import\("\.\/m\.mjs/,
    );
  });

  it("reports each of several calls in one file", () => {
    assert.equal(
      unanalyzableLoaderCalls(
        [
          "export const a = (n) => import(n);",
          "export const b = (n) => __require(n);",
          'export const c = (n) => require("zo" + n);',
          'export const ok = () => import("./m.mjs");',
        ].join("\n"),
      ).length,
      3,
    );
  });
});

describe("collectModuleGraph", () => {
  it("follows a relative chunk edge and on into node_modules", async () => {
    const graph = await collectModuleGraph({
      entryFile: fixture("purity-entry.mjs"),
      pkgRoot,
    });
    const entryText = fs.readFileSync(fixture("purity-entry.mjs"), "utf8");
    // The whole point: the entry file itself names no dependency, so a scan that
    // reads only the entry cannot see what the graph contains.
    assert.ok(!entryText.includes("zod"));
    assert.ok(
      graph.inputs.some((input) => input.endsWith("purity-chunk.mjs")),
      "the relative chunk must be in the graph",
    );
    assert.ok(
      graph.inputs.some((input) => /node_modules\/zod\//.test(input)),
      "the dep behind the chunk must be in the graph",
    );
  });

  // Three of the six real targets are `.cjs`, which takes the script's
  // `format: "cjs"` branch and carries the `require()` loader shape.
  it('walks a CommonJS entry through the format:"cjs" branch', async () => {
    const graph = await collectModuleGraph({
      entryFile: fixture("purity-entry.cjs"),
      pkgRoot,
    });
    const entryText = fs.readFileSync(fixture("purity-entry.cjs"), "utf8");
    assert.ok(!entryText.includes("zod"));
    assert.ok(
      graph.inputs.some((input) => input.endsWith("purity-chunk.cjs")),
      "the relative require() edge must be in the graph",
    );
    assert.ok(
      graph.inputs.some((input) => /node_modules\/zod\//.test(input)),
      "the dep behind that require() must be in the graph",
    );
  });

  it("fails loudly on an edge it cannot resolve instead of reading as clean", async () => {
    await assert.rejects(
      collectModuleGraph({
        entryFile: fixture("purity-broken-entry.mjs"),
        pkgRoot,
      }),
      (error) => {
        assert.match(error.message, /could not resolve the module graph/);
        assert.match(error.message, /purity-does-not-exist/);
        return true;
      },
    );
  });
});

describe("assertEntryPurity", () => {
  it("catches a forbidden dep reached only through a relative chunk edge", async () => {
    const report = await assertEntryPurity({
      entryFile: fixture("purity-entry.mjs"),
      pkgRoot,
      forbidden: STAND_IN,
    });
    assert.deepEqual(report.hits, [{ dep: "zod", via: ["zod"] }]);
  });

  it("passes the same graph when nothing forbidden is in it", async () => {
    const report = await assertEntryPurity({
      entryFile: fixture("purity-entry.mjs"),
      pkgRoot,
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(report.hits, []);
    assert.deepEqual(report.unanalyzable, []);
    assert.deepEqual(report.blindingWarnings, []);
  });

  it("does NOT fail on banned tokens that appear only in comments and strings", async () => {
    const text = fs.readFileSync(fixture("purity-comment-entry.mjs"), "utf8");
    // Guard the guard's test: a fixture that lost its tokens would pass vacuously.
    for (const dep of REAL_FORBIDDEN) {
      assert.ok(text.includes(dep), `fixture must still mention ${dep}`);
    }
    const report = await assertEntryPurity({
      entryFile: fixture("purity-comment-entry.mjs"),
      pkgRoot,
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(report.hits, []);
    assert.deepEqual(report.unanalyzable, []);
  });

  it("reports a loader call a bundler cannot see through, rather than calling it clean", async () => {
    const report = await assertEntryPurity({
      entryFile: fixture("purity-unanalyzable-entry.mjs"),
      pkgRoot,
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(report.hits, []);
    assert.equal(report.unanalyzable.length, 1);
    assert.match(report.unanalyzable[0], /purity-unanalyzable-entry\.mjs/);
  });

  it("catches a forbidden dep behind a relative require() edge (cjs entry)", async () => {
    const report = await assertEntryPurity({
      entryFile: fixture("purity-entry.cjs"),
      pkgRoot,
      forbidden: STAND_IN,
    });
    assert.deepEqual(report.hits, [{ dep: "zod", via: ["zod"] }]);
    assert.deepEqual(report.unanalyzable, []);
  });

  it("reports BOTH __require and a concatenated require() in a cjs entry, and neither counter-example", async () => {
    const report = await assertEntryPurity({
      entryFile: fixture("purity-cjs-unanalyzable-entry.cjs"),
      pkgRoot,
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(report.hits, []);
    // The static `require("./purity-chunk.cjs")` and the import-shaped text in
    // `message` must contribute nothing; the two hidden loaders must both appear.
    assert.equal(
      report.unanalyzable.length,
      2,
      `expected two reports, got ${JSON.stringify(report.unanalyzable)}`,
    );
    assert.ok(report.unanalyzable.some((r) => /__require\(name\)/.test(r)));
    assert.ok(
      report.unanalyzable.some((r) => /require\("zo" \+ name\)/.test(r)),
    );
  });
});

describe("classStaticBlocks", () => {
  it("finds a class static block, including one written `static{`", () => {
    assert.equal(
      classStaticBlocks("class A {\n  static {\n    x();\n  }\n}").length,
      1,
    );
    assert.equal(classStaticBlocks("class A { static{ x(); } }").length, 1);
  });

  it("reports the line of each block", () => {
    const found = classStaticBlocks("const a = 1;\nclass A {\n  static {}\n}");
    assert.equal(found.length, 1);
    assert.match(found[0], /^line 3:/);
  });

  it("ignores static fields, static methods, a `static` key and every mention in text", () => {
    assert.deepEqual(
      classStaticBlocks(
        [
          "// class B { static { init(); } }",
          "/* static { */",
          'const s = "static {";',
          "const t = `static {`;",
          "const o = { static: { a: 1 } };",
          "class A {",
          "  static contextType = null;",
          "  static create() { return {}; }",
          "  static async load() {}",
          "}",
        ].join("\n"),
      ),
      [],
    );
  });

  it("does not mistake a sloppy-mode identifier `static` followed by a block", () => {
    // Third-party CommonJS is scanned too, and outside strict mode `static` is a
    // legal identifier: an expression statement ending in it, then a block on the
    // next line (ASI), reads as `static {` once whitespace is ignored.
    assert.deepEqual(
      classStaticBlocks(
        [
          "var static = 1;",
          "static",
          "{ console.log(static); }",
          "function f() {",
          "  static",
          "  { return 1; }",
          "}",
          "var o = { class: 1, run: function () { static",
          "{ } } };",
        ].join("\n"),
      ),
      [],
    );
  });

  it("still finds a static block in every kind of class body", () => {
    assert.deepEqual(
      classStaticBlocks(
        [
          "class A extends mixin({ a: {} }, [{}]) {", // `{` inside the heritage
          "  static {}", // line 2
          "}",
          "const B = class {", // a class expression
          "  m() { return { static: 1 }; }",
          "  static {}", // line 6, after a nested object literal
          "};",
          "class C { inner() { return class { static {} }; } static {} }", // line 8 twice
          "class D extends E",
          "{",
          "  static", // line 11: a class element may break before its `{`
          "  {}",
          "}",
        ].join("\n"),
      ).map((block) => block.slice(0, block.indexOf(":"))),
      ["line 2", "line 6", "line 8", "line 8", "line 11"],
    );
  });

  it("finds the outer static block when a class expression sits in the `extends` clause", () => {
    // Each inner class's body opens first; the outer class must still be waiting
    // for its own.
    const lines = (source) =>
      classStaticBlocks(source).map((block) =>
        block.slice(0, block.indexOf(":")),
      );
    assert.deepEqual(
      lines("class A extends Mixin(class {}) { static { init(); } }"),
      ["line 1"],
    );
    assert.deepEqual(
      lines("class A extends (c ? class {} : B) {\n  static {}\n}"),
      ["line 2"],
    );
    assert.deepEqual(lines("class A extends class B {} {\n  static {}\n}"), [
      "line 2",
    ]);
    assert.deepEqual(
      lines("var A = class extends (class {}) { static { x = 1; } };"),
      ["line 1"],
    );
    assert.deepEqual(
      lines(
        [
          "class A extends mix(class B extends class {} { static {} }) {", // line 1
          "  static {}", // line 2
          "}",
        ].join("\n"),
      ),
      ["line 1", "line 2"],
    );
  });

  it("does not take a member, method or field named `class` for a class", () => {
    // `class` is a legal property name. None of these opens a class body, so the
    // sloppy-mode `static` + next-line block inside each must not be reported.
    assert.deepEqual(
      classStaticBlocks(
        [
          "var o = { class() { static",
          "{ } } };",
          "var p = { get class() { static",
          "{ } }, set class(v) { static",
          "{ } } };",
          "var q = { async class () { static",
          "{ } }, *class() { static",
          "{ } } };",
        ].join("\n"),
      ),
      [],
    );
    // A class whose members are named `class` is still a class.
    assert.deepEqual(
      classStaticBlocks(
        "class A { class() {} static class() {} #class = {}; class = {}; static {} }",
      ).length,
      1,
    );
  });
});

describe("staticBlocksIn — inputs it cannot read", () => {
  it("fails loudly on an unreadable first-party input when called on its own", () => {
    const { blocks, unreadable } = staticBlocksIn({
      inputs: ["dist/purity-does-not-exist.mjs"],
      pkgRoot,
    });
    assert.deepEqual(blocks, []);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0], /^dist\/purity-does-not-exist\.mjs — /);
  });

  it("skips an input esbuild disabled through a browser field: it ships no code", () => {
    assert.deepEqual(
      staticBlocksIn({
        inputs: ["(disabled):node_modules/depx/node.js"],
        pkgRoot,
      }),
      { blocks: [], unreadable: [] },
    );
  });

  it("reports an unreadable first-party input once, not once per scan", async () => {
    // assertEntryPurity merges unanalyzableEdgesIn and staticBlocksIn; both see
    // the same missing file, and the reader should see it once.
    assert.equal(typeof gate.mergeUnreadable, "function");
    assert.deepEqual(
      gate.mergeUnreadable(
        ["dist/x.mjs — in the graph but not readable on disk"],
        [
          "dist/x.mjs — in the graph but not readable on disk, so it was not scanned for class static blocks",
          "../node_modules/y/z.js — in the graph but not readable on disk, so it was not scanned for class static blocks",
        ],
      ),
      [
        "dist/x.mjs — in the graph but not readable on disk",
        "../node_modules/y/z.js — in the graph but not readable on disk, so it was not scanned for class static blocks",
      ],
    );
  });
});

// The /generative-ui/native entry is what @copilotkit/react-native imports, and
// its contract is stricter than the other targets': no react-dom, no Lit packages,
// none of @a2ui/web_core's Lit-based modules, and no class static block in any
// JavaScript file of the graph. Each fixture below is one way to break it, or a
// shape it must not trip on; under the headless contract alone, every violating
// fixture would pass.
describe("contractFor — the generative-ui/native contract", () => {
  const NATIVE = "generative-ui/native.mjs";
  const purity = (name, target = NATIVE) =>
    assertEntryPurity({
      entryFile: fixture(name),
      pkgRoot,
      ...contractFor(target),
    });

  it("gives both native builds the same, full native contract", () => {
    const mjs = contractFor("generative-ui/native.mjs");
    const cjs = contractFor("generative-ui/native.cjs");
    assert.equal(mjs.name, "native");
    assert.deepEqual(cjs, mjs);
    assert.deepEqual(mjs.forbidden, [...REAL_FORBIDDEN, "react-dom", "lit"]);
    assert.equal(mjs.forbiddenPaths.length, 2);
    assert.equal(mjs.forbidStaticBlocks, true);
  });

  it("holds /headless and /context to the same Hermes/Metro checks", () => {
    // @copilotkit/react-native imports these two entries as well (see
    // packages/react-native/src), so Hermes loads them and Metro bundles them:
    // react-dom, Lit, the Lit-based a2ui modules and static blocks break an RN app
    // there exactly as they do through /generative-ui/native.
    const native = contractFor("generative-ui/native.mjs");
    for (const target of [
      "headless.mjs",
      "headless.cjs",
      "context.mjs",
      "context.cjs",
    ]) {
      const contract = contractFor(target);
      assert.equal(contract.name, "headless", target);
      assert.deepEqual(contract.forbidden, native.forbidden, target);
      assert.deepEqual(contract.forbiddenPaths, native.forbiddenPaths, target);
      assert.equal(contract.forbidStaticBlocks, true, target);
      // Only the explanation differs: where the offending code belongs instead.
      assert.notEqual(contract.advice, native.advice, target);
    }
  });

  it("proves react-native really imports exactly those three react-core entries", () => {
    // The evidence the contract split rests on, kept live: if react-native starts
    // importing another react-core entry, `targets` must grow with it.
    assert.deepEqual(
      reactCoreEntriesImportedBy(
        path.join(repoRoot, "packages/react-native/src"),
      ),
      [
        "@copilotkit/react-core/context",
        "@copilotkit/react-core/generative-ui/native",
        "@copilotkit/react-core/headless",
      ],
    );
  });

  it("sees every way a source file can load a react-core entry", () =>
    withScratch("rn-imports-", (root) => {
      writeTree(root, {
        "double.ts": `import { a } from "${coreEntry("double")}";`,
        "single.tsx": `import { b } from '${coreEntry("single")}';`,
        "side-effect.ts": `import "${coreEntry("side-effect")}";`,
        "dynamic.ts": `const m = () => import(\n  "${coreEntry("dynamic")}"\n);`,
        "required.js": `const r = require('${coreEntry("required")}');`,
        "re-export.ts": `export { c } from "${coreEntry("re-export")}";`,
        "plain.mjs": `import * as d from "${coreEntry("plain")}";`,
        "nested/deep.jsx": `import e from "${coreEntry("deep")}";`,
        "inline-type.ts": `import { type F, g } from "${coreEntry("inline-type")}";`,
        "after-comment.ts": `import /* a */ h /* b */ from /* c */ "${coreEntry("after-comment")}";`,
        // None of these loads anything at runtime, or ships in the package.
        "commented.ts": [
          `// import { x } from "${coreEntry("line-comment")}";`,
          `/* import "${coreEntry("block-comment")}"; */`,
          `const s = "import '${coreEntry("string")}'";`,
        ].join("\n"),
        "types-only.ts": [
          `import type { T } from "${coreEntry("import-type")}";`,
          `export type { U } from "${coreEntry("export-type")}";`,
          `import type {\n  V,\n} from "${coreEntry("multiline-type")}";`,
        ].join("\n"),
        "ambient.d.ts": `import { W } from "${coreEntry("declaration")}";`,
        "__mocks__/mock.tsx": `import { m } from "${coreEntry("mock")}";`,
        "__tests__/a.test.ts": `import { t } from "${coreEntry("test")}";`,
        "unrelated.ts": `import { y } from "@copilotkit/react-core-other";`,
      });
      assert.deepEqual(
        reactCoreEntriesImportedBy(root),
        [
          "after-comment",
          "deep",
          "double",
          "dynamic",
          "inline-type",
          "plain",
          "re-export",
          "required",
          "side-effect",
          "single",
        ].map(coreEntry),
      );
    }));

  it("fails a native entry that imports react-dom, which stays external", async () => {
    const report = await purity("purity-native-react-dom-entry.mjs");
    assert.deepEqual(report.hits, [{ dep: "react-dom", via: ["react-dom"] }]);
  });

  it("fails the same react-dom import under the headless contract too", async () => {
    // /headless reaches React Native as well, so react-dom is banned there.
    const report = await purity(
      "purity-native-react-dom-entry.mjs",
      "headless.mjs",
    );
    assert.deepEqual(report.hits, [{ dep: "react-dom", via: ["react-dom"] }]);
  });

  it("skips the path and static-block checks when a caller does not ask for them", async () => {
    // assertEntryPurity's defaults: only the package list is checked. The gate
    // always passes all three fields; this keeps the opt-in explicit.
    const barrel = await assertEntryPurity({
      entryFile: fixture("purity-native-a2ui-barrel-entry.mjs"),
      pkgRoot,
      forbidden: STAND_IN,
    });
    assert.deepEqual(barrel.pathHits, []);
    const statics = await assertEntryPurity({
      entryFile: fixture("purity-native-static-block-entry.mjs"),
      pkgRoot,
      forbidden: STAND_IN,
    });
    assert.deepEqual(statics.staticBlocks, []);
  });

  it("fails a native entry that imports lit", async () => {
    // Stub lit packages: react-core does not depend on lit, so the real one
    // does not resolve from here.
    await withScratch("purity-lit-", async (root) => {
      writeTree(root, {
        "node_modules/lit/package.json": {
          name: "lit",
          version: "0.0.0",
          main: "index.js",
        },
        "node_modules/lit/index.js":
          'export { html as LitElement } from "lit-html";\n',
        "node_modules/lit-html/package.json": {
          name: "lit-html",
          version: "0.0.0",
          main: "index.js",
        },
        "node_modules/lit-html/index.js": "export const html = document;\n",
        // lit-html reads `document` while its module loads, which throws
        // under Hermes before any component renders.
        "entry.mjs":
          'import { LitElement } from "lit";\n' +
          "export class Widget extends LitElement {}\n",
      });
      const report = await assertEntryPurity({
        entryFile: path.join(root, "entry.mjs"),
        pkgRoot,
        ...contractFor(NATIVE),
      });
      const lit = report.hits.find(({ dep }) => dep === "lit");
      assert.ok(lit, `expected a lit hit, got ${JSON.stringify(report.hits)}`);
      assert.ok(lit.via.includes("lit"));
      assert.ok(
        lit.via.includes("lit-html"),
        "lit-html is what reads `document`",
      );
    });
  });

  it("fails a native entry that imports the @a2ui/web_core/v0_9 barrel", async () => {
    // The surface manager's old regression: one model import through the
    // barrel drags the Lit basic catalog in.
    const report = await purity("purity-native-a2ui-barrel-entry.mjs");
    assert.ok(
      report.pathHits.some((hit) =>
        hit.includes("@a2ui/web_core/src/v0_9/basic_catalog/"),
      ),
      `expected a basic_catalog path hit, got ${JSON.stringify(report.pathHits)}`,
    );
    assert.ok(
      report.pathHits.some((hit) =>
        hit.includes("@a2ui/web_core/src/universal/"),
      ),
      `expected a universal path hit, got ${JSON.stringify(report.pathHits)}`,
    );
    assert.ok(report.hits.some(({ dep }) => dep === "lit"));
  });

  it("fails a native entry whose first-party code has a class static block", async () => {
    const report = await purity("purity-native-static-block-entry.mjs");
    assert.ok(Array.isArray(report.staticBlocks), "staticBlocks is reported");
    assert.equal(
      report.staticBlocks.length,
      1,
      `expected one static block, got ${JSON.stringify(report.staticBlocks)}`,
    );
    assert.match(
      report.staticBlocks[0],
      /purity-native-static-block-entry\.mjs — line 5:/,
    );
  });

  it("fails a native entry whose static block sits in a relative chunk", async () => {
    const report = await purity("purity-native-static-block-chunk-entry.mjs");
    assert.equal(report.staticBlocks.length, 1);
    assert.match(
      report.staticBlocks[0],
      /purity-native-static-block-chunk\.mjs — line 5:/,
    );
  });

  it("fails a CommonJS native entry whose static block sits behind require()", async () => {
    const report = await purity(
      "purity-native-static-block-entry.cjs",
      "generative-ui/native.cjs",
    );
    assert.equal(report.staticBlocks.length, 1);
    assert.match(
      report.staticBlocks[0],
      /purity-native-static-block-chunk\.cjs — line 3:/,
    );
  });

  it("fails a native entry whose static block ships in a node_modules dependency", async () => {
    // Metro runs Babel over node_modules too, so a dependency's static block
    // breaks the bundle exactly like one of ours.
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "purity-static-dep-")),
    );
    try {
      const dep = path.join(root, "node_modules", "purity-static-dep");
      fs.mkdirSync(dep, { recursive: true });
      fs.writeFileSync(
        path.join(dep, "package.json"),
        JSON.stringify({ name: "purity-static-dep", main: "index.mjs" }),
      );
      fs.writeFileSync(
        path.join(dep, "index.mjs"),
        "export class Dep {\n  static {\n    this.ready = true;\n  }\n}\n",
      );
      const entryFile = path.join(root, "entry.mjs");
      fs.writeFileSync(entryFile, 'export { Dep } from "purity-static-dep";\n');
      const report = await assertEntryPurity({
        entryFile,
        pkgRoot,
        ...contractFor(NATIVE),
      });
      assert.equal(
        report.staticBlocks.length,
        1,
        `expected one static block, got ${JSON.stringify(report.staticBlocks)}`,
      );
      assert.match(
        report.staticBlocks[0],
        /node_modules\/purity-static-dep\/index\.mjs — line 2:/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails a native entry that imports a react-dom subpath", async () => {
    const report = await purity("purity-native-react-dom-client-entry.mjs");
    assert.deepEqual(report.hits, [{ dep: "react-dom", via: ["react-dom"] }]);
  });

  it("passes a clean native entry that names every banned shape only in text", async () => {
    // Guard the guard: without these mentions the test would pass vacuously.
    const text = fs.readFileSync(
      fixture("purity-native-clean-entry.mjs"),
      "utf8",
    );
    for (const mention of [
      '"react-dom"',
      '"lit"',
      '"lit-html"',
      "static {",
      "static contextType",
      "static create(",
      "static: {",
    ]) {
      assert.ok(
        text.includes(mention),
        `fixture no longer mentions ${mention}`,
      );
    }
    const report = await purity("purity-native-clean-entry.mjs");
    assert.deepEqual(report.hits, []);
    assert.deepEqual(report.pathHits, []);
    assert.deepEqual(report.staticBlocks, []);
    assert.deepEqual(report.unanalyzable, []);
    assert.deepEqual(report.blindingWarnings, []);
  });

  it("does not call a dependency file disabled by its browser field unscannable", async () => {
    await withScratch("purity-disabled-", async (root) => {
      writeTree(root, DISABLED_DEP_TREE);
      const report = await assertEntryPurity({
        entryFile: path.join(root, "entry.mjs"),
        pkgRoot,
        ...contractFor(NATIVE),
      });
      assert.deepEqual(report.unanalyzable, []);
      assert.deepEqual(report.staticBlocks, []);
      assert.deepEqual(report.hits, []);
    });
  });

  it("catches a Lit-based @a2ui/web_core module linked from a local checkout", async () => {
    // A `link:` / override puts the package OUTSIDE node_modules, so a path rule
    // anchored on `node_modules/` would never match it. Same for a linked Lit.
    await withScratch("purity-linked-", async (root) => {
      writeTree(root, {
        "vendor/web_core/package.json": {
          name: "@a2ui/web_core",
          version: "0.0.0",
        },
        "vendor/web_core/src/universal/element.js":
          "export const element = 1;\n",
        "vendor/lit-html/package.json": { name: "lit-html", version: "0.0.0" },
        "vendor/lit-html/index.js": "export const html = 1;\n",
        "entry.mjs":
          'export { element } from "@a2ui/web_core/src/universal/element.js";\n' +
          'export { html } from "lit-html";\n',
      });
      fs.mkdirSync(path.join(root, "node_modules/@a2ui"), { recursive: true });
      fs.symlinkSync(
        path.join(root, "vendor/web_core"),
        path.join(root, "node_modules/@a2ui/web_core"),
        "dir",
      );
      fs.symlinkSync(
        path.join(root, "vendor/lit-html"),
        path.join(root, "node_modules/lit-html"),
        "dir",
      );
      const report = await assertEntryPurity({
        entryFile: path.join(root, "entry.mjs"),
        pkgRoot,
        ...contractFor(NATIVE),
      });
      // Guard the guard: the inputs really are outside node_modules.
      assert.equal(report.pathHits.length, 1, JSON.stringify(report.pathHits));
      assert.ok(!report.pathHits[0].includes("node_modules"));
      assert.match(report.pathHits[0], /vendor\/web_core\/src\/universal\//);
      assert.deepEqual(report.hits, [{ dep: "lit", via: ["lit-html"] }]);
    });
  });
});

// What the CLI does with a report: which targets it scans, which contract fields
// it hands to the scan, its exit code, and the closing advice. `runGate` is the
// CLI block itself (the entry only adds `process.exit`), driven here over a
// temporary dist so each case controls exactly which target fails and how.
describe("runGate (the CLI block)", () => {
  /**
   * A temporary dist whose files are given as { target: source }. Its
   * `node_modules` links to this package's, so an inline dist source can import
   * a package directly (`katex`) as a built entry would; a fixture re-exported by
   * absolute path (`reexport`) resolves from its own location instead.
   */
  const withDist = (files, run) =>
    withScratch("purity-cli-", async (root) => {
      const link = path.join(root, "node_modules");
      try {
        fs.symlinkSync(path.join(pkgRoot, "node_modules"), link, "dir");
        writeTree(path.join(root, "dist"), files);
        return await run(path.join(root, "dist"));
      } finally {
        // Unlink the symlink first (if it was made): never hand a recursive
        // remove a link that points at this package's node_modules.
        if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
      }
    });

  const runGate = (dist, targets) => {
    const lines = [];
    const sink = (...args) => lines.push(args.join(" "));
    return gate
      .runGate({
        dist,
        pkgRoot,
        targets,
        log: { log: sink, warn: sink, error: sink },
      })
      .then((exitCode) => ({ exitCode, output: lines.join("\n") }));
  };

  /** An entry that re-exports a fixture by absolute path. */
  const reexport = (name) =>
    `export * from ${JSON.stringify(fixture(name))};\n`;

  const HEADLESS_ADVICE = /belongs in the main entry/;
  const NATIVE_ADVICE = /belongs in the web \/generative-ui entry/;

  it("scans both native builds, under the native contract", () => {
    assert.ok(Array.isArray(gate.targets), "targets is exported");
    for (const target of [
      "generative-ui/native.mjs",
      "generative-ui/native.cjs",
    ]) {
      assert.ok(gate.targets.includes(target), target);
      assert.equal(contractFor(target).name, "native", target);
    }
    for (const target of [
      "headless.mjs",
      "headless.cjs",
      "context.mjs",
      "context.cjs",
    ]) {
      assert.ok(gate.targets.includes(target), target);
      assert.equal(contractFor(target).name, "headless", target);
    }
    assert.equal(gate.targets.length, 6);
  });

  it("exits 0 when every target meets its contract", async () => {
    await withDist(
      {
        "headless.mjs": "export const a = 1;\n",
        "generative-ui/native.mjs": reexport("purity-native-clean-entry.mjs"),
      },
      async (dist) => {
        const { exitCode, output } = await runGate(dist, [
          "headless.mjs",
          "generative-ui/native.mjs",
        ]);
        assert.equal(exitCode, 0, output);
        assert.doesNotMatch(output, /✗/);
      },
    );
  });

  it("hands the scan forbidStaticBlocks: a native static block exits 1", async () => {
    await withDist(
      {
        "generative-ui/native.mjs": reexport(
          "purity-native-static-block-entry.mjs",
        ),
      },
      async (dist) => {
        const { exitCode, output } = await runGate(dist, [
          "generative-ui/native.mjs",
        ]);
        assert.equal(exitCode, 1, output);
        assert.match(output, /has class static blocks/);
        assert.match(output, NATIVE_ADVICE);
      },
    );
  });

  it("hands the scan forbiddenPaths: the @a2ui/web_core/v0_9 barrel exits 1", async () => {
    await withDist(
      {
        "generative-ui/native.mjs": reexport(
          "purity-native-a2ui-barrel-entry.mjs",
        ),
      },
      async (dist) => {
        const { exitCode, output } = await runGate(dist, [
          "generative-ui/native.mjs",
        ]);
        assert.equal(exitCode, 1, output);
        assert.match(output, /links forbidden modules:/);
        assert.match(output, /@a2ui\/web_core\/src\/universal\//);
      },
    );
  });

  it("names only the failing entries in the closing advice", async () => {
    await withDist(
      {
        "headless.mjs":
          'import { createPortal } from "react-dom";\nexport const k = createPortal;\n',
        "context.mjs": "export const c = 1;\n",
      },
      async (dist) => {
        const { exitCode, output } = await runGate(dist, [
          "headless.mjs",
          "context.mjs",
        ]);
        assert.equal(exitCode, 1, output);
        assert.match(output, /✓ context\.mjs/);
        const advice = output.slice(output.indexOf("(headless contract)") - 80);
        assert.match(advice, /\/headless/);
        assert.doesNotMatch(
          advice,
          /\/context/,
          "context.mjs passed, so the advice must not name it",
        );
      },
    );
  });

  it("does not print contract advice when the scan itself fails", async () => {
    await withDist(
      {
        // headless.mjs is missing; context.mjs has an edge that cannot resolve.
        "context.mjs": 'export * from "./purity-does-not-exist.mjs";\n',
      },
      async (dist) => {
        const { exitCode, output } = await runGate(dist, [
          "headless.mjs",
          "context.mjs",
          "generative-ui/native.mjs",
        ]);
        assert.equal(exitCode, 1, output);
        assert.match(output, /✗ headless\.mjs not found/);
        assert.match(output, /✗ context\.mjs .*could not resolve/);
        assert.doesNotMatch(output, HEADLESS_ADVICE);
        assert.doesNotMatch(output, NATIVE_ADVICE);
        assert.doesNotMatch(output, /contract\)/);
        assert.match(output, /could not be scanned/);
      },
    );
  });

  // ─── Failure paths, one row per (cause × contract) ─────────────────────────
  // Every way the gate can end, asserting the exit code and the EXACT closing
  // advice, so a branch that drops a diagnosis (or prints the wrong advice) fails
  // here rather than in a reviewer's head.
  const CONTRACT_ADVICE = (entries, target) => {
    const contract = contractFor(target);
    return (
      `\n${entries} (${contract.name} contract) ${contract.summary}.\n` +
      contract.advice
    );
  };
  const OPAQUE_CALL = "export const load = (name) => import(name);\n";
  /** A dist entry that re-exports the scratch package's entry by absolute path. */
  const scratchEntry = (target) => (root) => ({
    [target]: `export { default } from ${JSON.stringify(path.join(root, "entry.mjs"))};\n`,
  });

  const FAILURE_PATHS = [
    {
      name: "a target that was never built",
      target: "headless.mjs",
      files: {},
      exitCode: 1,
      lines: [/✗ headless\.mjs not found/],
      advice: [SCAN_ADVICE("headless.mjs", false)],
    },
    {
      name: "two targets that were never built",
      targets: ["context.mjs", "generative-ui/native.cjs"],
      files: {},
      exitCode: 1,
      lines: [
        /✗ context\.mjs not found/,
        /✗ generative-ui\/native\.cjs not found/,
      ],
      advice: [SCAN_ADVICE("context.mjs, generative-ui/native.cjs", true)],
    },
    {
      name: "an import esbuild cannot resolve (headless)",
      target: "context.cjs",
      files: { "context.cjs": 'module.exports = require("./missing.cjs");\n' },
      exitCode: 1,
      lines: [/✗ context\.cjs — could not resolve the module graph/],
      advice: [SCAN_ADVICE("context.cjs", false)],
    },
    {
      name: "an import esbuild cannot resolve (native)",
      target: "generative-ui/native.mjs",
      files: { "generative-ui/native.mjs": 'export * from "./missing.mjs";\n' },
      exitCode: 1,
      lines: [/✗ generative-ui\/native\.mjs — could not resolve/],
      advice: [SCAN_ADVICE("generative-ui/native.mjs", false)],
    },
    {
      name: "a dependency file disabled by its browser field (native)",
      target: "generative-ui/native.mjs",
      scratch: DISABLED_DEP_TREE,
      files: scratchEntry("generative-ui/native.mjs"),
      exitCode: 0,
      lines: [/✓ generative-ui\/native\.mjs .*meets the native contract/],
      advice: [],
    },
    {
      name: "a dependency file disabled by its browser field (headless)",
      target: "headless.mjs",
      scratch: DISABLED_DEP_TREE,
      files: scratchEntry("headless.mjs"),
      exitCode: 0,
      lines: [/✓ headless\.mjs .*meets the headless contract/],
      advice: [],
    },
    {
      name: "a real violation next to an edge the scan cannot follow (headless)",
      target: "headless.mjs",
      files: {
        "headless.mjs": `import { createPortal } from "react-dom";\nexport const k = createPortal;\n${OPAQUE_CALL}`,
      },
      exitCode: 1,
      lines: [
        /✗ headless\.mjs has edges this scan cannot follow[^]*import\(name\)/,
        /✗ headless\.mjs breaks the headless contract[^]*links forbidden packages: react-dom/,
      ],
      advice: [
        CONTRACT_ADVICE("/headless", "headless.mjs"),
        SCAN_ADVICE("headless.mjs", false),
      ],
    },
    {
      name: "a real violation next to an edge the scan cannot follow (native)",
      target: "generative-ui/native.mjs",
      files: {
        "generative-ui/native.mjs":
          `export * from ${JSON.stringify(fixture("purity-native-static-block-entry.mjs"))};\n` +
          `import "react-dom";\n${OPAQUE_CALL}`,
      },
      exitCode: 1,
      lines: [
        /✗ generative-ui\/native\.mjs has edges this scan cannot follow/,
        /links forbidden packages: react-dom/,
        /has class static blocks, which Metro cannot parse:/,
      ],
      advice: [
        CONTRACT_ADVICE("/generative-ui/native", "generative-ui/native.mjs"),
        SCAN_ADVICE("generative-ui/native.mjs", false),
      ],
    },
    {
      name: "a react-dom import under the headless contract",
      target: "context.mjs",
      files: { "context.mjs": 'export { createPortal } from "react-dom";\n' },
      exitCode: 1,
      lines: [/✗ context\.mjs breaks the headless contract/],
      advice: [CONTRACT_ADVICE("/context", "context.mjs")],
    },
  ];

  for (const row of FAILURE_PATHS) {
    it(`ends with exit ${row.exitCode} and the right advice: ${row.name}`, () =>
      withScratch("purity-row-", async (scratch) => {
        if (row.scratch) writeTree(scratch, row.scratch);
        const files =
          typeof row.files === "function" ? row.files(scratch) : row.files;
        await withDist(files, async (dist) => {
          const { exitCode, output } = await runGate(
            dist,
            row.targets ?? [row.target],
          );
          assert.equal(exitCode, row.exitCode, output);
          for (const line of row.lines) assert.match(output, line);
          for (const advice of row.advice) {
            assert.ok(
              output.includes(advice),
              `expected the exact advice\n${advice}\n--- in ---\n${output}`,
            );
          }
          // And no closing advice the row did not ask for.
          const closing = output.match(
            /\n\n[^\n]*(?:\(\w+ contract\)|could not be scanned)/g,
          );
          assert.equal(closing?.length ?? 0, row.advice.length, output);
        });
      }));
  }
});

// The gate can only fail CI if its CLI block actually RUNS. Comparing
// `import.meta.url` to a `file://`-concatenated `process.argv[1]` is false
// whenever the checkout path needs URL encoding (a SPACE) or is reached through a
// symlink, and a false guard makes this hard-fail gate exit 0 having printed and
// asserted nothing. These tests cover the guard.
describe("isEntrypoint (the CLI entry guard)", () => {
  /** A real file under a real directory whose name contains a space. */
  const withSpaceFixture = (run) =>
    withScratch("entry-guard-", (root) => {
      writeTree(root, { "dir with space/script.mjs": "export {};\n" });
      return run({
        root,
        file: path.join(root, "dir with space", "script.mjs"),
      });
    });

  it("holds for a plain path", () => {
    const self = fileURLToPath(import.meta.url);
    assert.equal(isEntrypoint(import.meta.url, self), true);
  });

  it("holds when the path contains a space (the percent-encoding trap)", () =>
    withSpaceFixture(({ file }) => {
      const url = pathToFileURL(file).href;
      // Guard the guard: without %20 in the URL this would pass vacuously.
      assert.ok(url.includes("%20"), `expected an encoded URL, got ${url}`);
      assert.notEqual(
        url,
        `file://${file}`,
        "the naive string comparison must be the thing that fails here",
      );
      assert.equal(isEntrypoint(url, file), true);
    }));

  it("holds when argv[1] reaches the script through a symlink", () =>
    withSpaceFixture(({ root, file }) => {
      const link = path.join(root, "link.mjs");
      fs.symlinkSync(file, link);
      // Node resolves `import.meta.url` to the realpath but leaves argv[1] as
      // typed, so these two strings genuinely differ.
      assert.notEqual(link, file);
      assert.equal(isEntrypoint(pathToFileURL(file).href, link), true);
    }));

  it("is false for a different file, for no argv[1], and for a non-file URL", () => {
    const self = fileURLToPath(import.meta.url);
    assert.equal(
      isEntrypoint(import.meta.url, path.join(path.dirname(self), "other.mjs")),
      false,
    );
    assert.equal(isEntrypoint(import.meta.url, undefined), false);
    assert.equal(isEntrypoint(import.meta.url, ""), false);
    assert.equal(isEntrypoint("data:text/javascript,0", self), false);
  });

  it("runs the real CLI block when spawned through a symlinked path with a space", () => {
    // End-to-end, because the unit cases above cannot catch the call site
    // regressing back to a string comparison. The alias is a symlink to this
    // package root whose name contains a space, so argv[1] differs from
    // `import.meta.url` in BOTH ways at once; relative resolution inside the
    // script still works because Node realpaths the module it loads.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "entry-guard-cli-"));
    const alias = path.join(root, "react core with space");
    let result;
    try {
      fs.symlinkSync(pkgRoot, alias, "dir");
      result = spawnSync(
        process.execPath,
        [path.join(alias, "scripts", "assert-headless-purity.mjs")],
        { encoding: "utf8" },
      );
    } finally {
      // Unlink the symlink itself (if it was made) before removing the temp dir:
      // never hand a recursive remove a link that points at the package root.
      if (fs.lstatSync(alias, { throwIfNoEntry: false })) fs.unlinkSync(alias);
      fs.rmdirSync(root);
    }

    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(
      output.trim(),
      "",
      "the CLI block printed nothing — the entry guard skipped the whole gate",
    );
    // State-agnostic: a built dist reports each entry, an unbuilt one reports it
    // as missing. Either proves the main block ran.
    assert.match(output, /headless\.mjs/);
  });
});

// Comments and advice rot silently: the gate's native advice once pointed at a
// `contextType` assignment in generative-ui/boundaries.tsx that a later commit
// removed, and nothing noticed. This guard reads every file path the gate script
// (and its native fixtures) cites, and requires each to be listed in CITED with
// the construct the text says that file shows. A new citation without an entry,
// an entry whose citation is gone, a missing file or a missing construct all fail.
describe("stale-reference guard for the gate's comments and advice", () => {
  const SOURCES = [
    scriptFile,
    ...fs
      .readdirSync(path.join(here, "fixtures"))
      .filter((name) => name.startsWith("purity-native-"))
      .map((name) => fixture(name)),
  ];
  const CITATION =
    /(?<![\w@./*-])(?:[\w@.-]+\/)*[\w-][\w.-]*\.(?:mjs|cjs|js|tsx?|md|json)(?![\w/])/g;
  /** Paths that are illustrations, not references to a file in this repo. */
  const NOT_A_REFERENCE = [
    /^dist\//, // build output, absent before a build
    /node_modules\//, // an example of a resolved third-party path
    /^\.\/chunk-abc\.mjs$/, // an example of a split-out chunk's name
  ];
  /** The gate's own targets, named relative to dist (build output). */
  const isTarget = (cited) => gate.targets.includes(cited);
  /** The text "isEntrypoint … Duplicated verbatim in <file>" holds only if it is. */
  const isEntrypointSource = (file) => {
    const text = fs.readFileSync(file, "utf8");
    const start = text.indexOf("export function isEntrypoint(");
    assert.notEqual(start, -1, `${file} has no isEntrypoint`);
    return text.slice(start, text.indexOf("\n}\n", start) + 3);
  };
  /** cited text → { file (from the repo root), contains?: string[], check?: fn } */
  const CITED = {
    "packages/react-native/src/__tests__/headless-entry-surface.test.ts": {
      file: "packages/react-native/src/__tests__/headless-entry-surface.test.ts",
      contains: [
        "@copilotkit/react-core/headless",
        "@copilotkit/react-core/context",
      ],
    },
    "dev-docs/bundle-size.md": {
      file: "dev-docs/bundle-size.md",
      contains: ["OSS-122"],
    },
    "src/headless.ts": {
      // "the five banned tokens sit in src/headless.ts's own file banner"
      file: "packages/react-core/src/headless.ts",
      check: (text) => {
        const banner = text.slice(0, text.indexOf("*/"));
        for (const token of REAL_FORBIDDEN) {
          assert.ok(banner.includes(token), `banner no longer names ${token}`);
        }
      },
    },
    "scripts/measure-copilotchat.mjs": {
      // Same fileURLToPath idiom, and react/react-dom kept external there too.
      file: "packages/react-core/scripts/measure-copilotchat.mjs",
      contains: ["fileURLToPath(import.meta.url)", '"react-dom"', '"react"'],
    },
    "scripts/__tests__/assert-headless-purity.test.mjs": {
      file: "packages/react-core/scripts/__tests__/assert-headless-purity.test.mjs",
      contains: ["describe("],
    },
    "packages/react-native/scripts/measure-headless.mjs": {
      file: "packages/react-native/scripts/measure-headless.mjs",
      check: (_text, file) =>
        assert.equal(
          isEntrypointSource(file),
          isEntrypointSource(scriptFile),
          "isEntrypoint is no longer duplicated verbatim",
        ),
    },
    "package.json": {
      // "Node 20.0–20.10, which the root package.json's `engines` floor
      // (\">=20\") still admits"
      file: "package.json",
      check: (text) => assert.equal(JSON.parse(text).engines?.node, ">=20"),
    },
    "scripts/assert-headless-purity.mjs": {
      // The static-block advice sends the reader to the script's header for why
      // a static field must be assigned after the class.
      file: "packages/react-core/scripts/assert-headless-purity.mjs",
      check: (text) => {
        const header = text.slice(0, text.indexOf("\nimport "));
        assert.match(header, /lowers a `static` class FIELD/);
        assert.match(header, /assign that static after\s+\/\/\s+the class/);
      },
    },
  };

  const citations = new Map();
  /** `./x` citations, which name a sibling of the citing file. */
  const relative = [];
  for (const source of SOURCES) {
    for (const [cited] of fs.readFileSync(source, "utf8").matchAll(CITATION)) {
      if (NOT_A_REFERENCE.some((pattern) => pattern.test(cited))) continue;
      if (isTarget(cited)) continue;
      if (cited.startsWith("./")) {
        relative.push({ source, cited });
        continue;
      }
      citations.set(cited, [
        ...(citations.get(cited) ?? []),
        path.basename(source),
      ]);
    }
  }

  it("finds the citations it is meant to check (guard the guard)", () => {
    assert.ok(citations.has("dev-docs/bundle-size.md"), [...citations.keys()]);
    assert.ok(citations.has("src/headless.ts"));
  });

  it("finds every ./sibling a fixture cites next to it", () => {
    assert.ok(relative.length > 0, "guard the guard: fixtures cite siblings");
    for (const { source, cited } of relative) {
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(source), cited)),
        `${path.basename(source)} cites ${cited}, which does not exist`,
      );
    }
  });

  it("lists every cited path, and cites every listed one", () => {
    const unlisted = [...citations.keys()].filter((cited) => !CITED[cited]);
    assert.deepEqual(
      unlisted.map((cited) => `${cited} (in ${citations.get(cited)})`),
      [],
      "a new citation needs an entry in CITED naming what it shows",
    );
    const stale = Object.keys(CITED).filter((cited) => !citations.has(cited));
    assert.deepEqual(stale, [], "these entries are no longer cited; drop them");
  });

  for (const [cited, claim] of Object.entries(CITED)) {
    it(`${cited} exists and still shows what the text says`, () => {
      const file = path.join(repoRoot, claim.file);
      assert.ok(fs.existsSync(file), `${claim.file} does not exist`);
      const text = fs.readFileSync(file, "utf8");
      for (const construct of claim.contains ?? []) {
        assert.ok(
          text.includes(construct),
          `${claim.file} no longer contains ${construct}`,
        );
      }
      claim.check?.(text, file);
    });
  }
});
