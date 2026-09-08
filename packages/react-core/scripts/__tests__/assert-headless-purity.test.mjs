// Negative tests for the #4893 hard-fail CI gate in
// scripts/assert-headless-purity.mjs. The gate shipped with no test, and every
// case below is a defect it actually had: it read four files and never followed an
// edge out of them, so a violation behind a relative chunk or an external package
// passed; and it matched raw substrings, so a banned token in a comment failed CI
// on code that linked nothing.
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
  collectModuleGraph,
  forbiddenHits,
  isEntrypoint,
  isForbiddenPackage,
  maskNonCode,
  packageNameFor,
  scanSource,
  unanalyzableLoaderCalls,
} from "../assert-headless-purity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "../..");
const fixture = (name) => path.join(here, "fixtures", name);

// `zod` stands in for a forbidden dep: it is a real dependency of this package, so
// it resolves through node_modules exactly as shiki/streamdown would, without
// making the test bundle 5.5 MB of grammars.
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
    assert.equal(packageNameFor("dist/v2/headless.mjs"), null);
    // The old guard's substring match would have flagged this file. A path is
    // not a dependency.
    assert.equal(packageNameFor("src/v2/katex-notes.ts"), null);
  });
});

describe("isForbiddenPackage", () => {
  it("matches the dep itself and the family it ships as", () => {
    assert.ok(isForbiddenPackage("shiki", "shiki"));
    assert.ok(isForbiddenPackage("@shikijs/langs", "shiki"));
    assert.ok(isForbiddenPackage("cytoscape-fcose", "cytoscape"));
  });

  it("is anchored, so an unrelated package that merely starts the same way passes", () => {
    assert.ok(!isForbiddenPackage("shikimori", "shiki"));
    assert.ok(!isForbiddenPackage("react-katexish", "katex"));
  });
});

describe("forbiddenHits", () => {
  it("flags a dep resolved into the graph", () => {
    const hits = forbiddenHits({
      inputs: [
        "dist/v2/headless.mjs",
        "../../node_modules/.pnpm/streamdown@1.3.0/node_modules/streamdown/dist/index.js",
      ],
      forbidden: REAL_FORBIDDEN,
    });
    assert.deepEqual(hits, [{ dep: "streamdown", via: ["streamdown"] }]);
  });

  it("does not flag a first-party path that merely contains the token", () => {
    assert.deepEqual(
      forbiddenHits({
        inputs: ["dist/v2/headless.mjs", "src/v2/lib/katex-helpers.ts"],
        forbidden: REAL_FORBIDDEN,
      }),
      [],
    );
  });

  it("flags a dep left EXTERNAL, which resolves to no graph input at all", () => {
    const hits = forbiddenHits({
      inputs: ["dist/v2/headless.mjs"],
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
    // The Round-2 defeat of a sibling guard: a `/*` hidden in a literal made the
    // stripper swallow everything to the next `*/`.
    const masked = maskNonCode(
      'const a = "/* not a comment";\nconst b = 2;\nconst c = 3;',
    );
    assert.ok(masked.includes("const b = 2;"));
    assert.ok(masked.includes("const c = 3;"));
  });

  it("does not let a regex literal containing // blank the rest of its line", () => {
    // The exact false NEGATIVE this detector shipped with: the `//` at the end of
    // `/https:\/\//` read as a comment start and hid the real call after it.
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

// Both directions of the loader-call detector. Every case in the two blocks below
// was a WRONG VERDICT the pre-tokenizer version actually gave, reproduced against
// the real gate: it blanked comments but left string, template and regex literals
// intact (so import-shaped TEXT hard-failed CI), matched a bare `\brequire` /
// `\bimport` (so member calls hard-failed and rolldown's `__require` escaped), and
// classified an argument as static from its FIRST CHARACTER alone (so anything
// merely starting with a quote read as clean while hiding its target).
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

  // Two of the four real targets are `.cjs`, which takes the script's
  // `format: "cjs"` branch and carries the `require()` loader shape — and until
  // these fixtures landed every fixture was `.mjs`, so that branch and that shape
  // were asserted by nothing at all.
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

// The gate can only fail CI if its CLI block actually RUNS. The first version of
// that guard compared `import.meta.url` to a `file://`-concatenated
// `process.argv[1]`, which is false whenever the checkout path needs URL encoding
// (a SPACE) or is reached through a symlink — and a false guard made this
// hard-fail gate exit 0 having printed and asserted nothing. Nothing covered the
// guard, which is exactly why that was invisible; these tests are that cover.
describe("isEntrypoint (the CLI entry guard)", () => {
  /** A real file under a real directory whose name contains a space. */
  const withSpaceFixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "entry-guard-"));
    const dir = path.join(root, "dir with space");
    fs.mkdirSync(dir);
    const file = path.join(dir, "script.mjs");
    fs.writeFileSync(file, "export {};\n");
    return { root, file };
  };

  it("holds for a plain path", () => {
    const self = fileURLToPath(import.meta.url);
    assert.equal(isEntrypoint(import.meta.url, self), true);
  });

  it("holds when the path contains a space (the percent-encoding trap)", () => {
    const { root, file } = withSpaceFixture();
    try {
      const url = pathToFileURL(file).href;
      // Guard the guard: without %20 in the URL this would pass vacuously.
      assert.ok(url.includes("%20"), `expected an encoded URL, got ${url}`);
      assert.notEqual(
        url,
        `file://${file}`,
        "the naive string comparison must be the thing that fails here",
      );
      assert.equal(isEntrypoint(url, file), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds when argv[1] reaches the script through a symlink", () => {
    const { root, file } = withSpaceFixture();
    const link = path.join(root, "link.mjs");
    try {
      fs.symlinkSync(file, link);
      // Node resolves `import.meta.url` to the realpath but leaves argv[1] as
      // typed, so these two strings genuinely differ.
      assert.notEqual(link, file);
      assert.equal(isEntrypoint(pathToFileURL(file).href, link), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

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
    fs.symlinkSync(pkgRoot, alias, "dir");
    let result;
    try {
      result = spawnSync(
        process.execPath,
        [path.join(alias, "scripts", "assert-headless-purity.mjs")],
        { encoding: "utf8" },
      );
    } finally {
      // Unlink the symlink itself before removing the temp dir: never hand a
      // recursive remove a link that points at the package root.
      fs.unlinkSync(alias);
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
