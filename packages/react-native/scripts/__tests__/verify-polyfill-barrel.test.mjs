// Standalone Node test (not vitest) — the check under test deliberately runs in
// a realm stripped of ReadableStream, TextEncoder, crypto and DOMException, and
// the package-wide vitest setup is jsdom, which supplies exactly those. Running
// with `node --test` keeps the probe honest. This mirrors the sibling
// measure-headless.test.mjs.
//
// Invoked from package.json `test:scripts` and the chained `test` command.
//
// What this locks down: verify-polyfill-barrel.mjs is the gate that stands
// between a tree-shaken barrel and npm (OSS-1002), so its FAILURE modes are the
// thing worth testing — an empty barrel must be rejected in both formats, a
// healthy one must pass, and an unbuilt package must say "run the build".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertBuilt,
  BUILD_COMMAND,
  checkEntryOrder,
  firstCjsSpecifier,
  firstEsmSpecifier,
  GROUPS,
  isEntrypoint,
  missingEsmImports,
  verifyBarrel,
} from "../verify-polyfill-barrel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures");
const emptyBarrel = path.join(fixtureDir, "dist-empty-barrel");
const completeBarrel = path.join(fixtureDir, "dist-complete-barrel");
const scriptPath = path.join(here, "..", "verify-polyfill-barrel.mjs");

// The CLI reads package.json next to dist/. Only the polyfill subpath, so the
// barrel fixtures are checked on their own.
const BARREL_ONLY_MANIFEST = JSON.stringify({
  exports: {
    "./polyfills": {
      import: "./dist/polyfills.mjs",
      require: "./dist/polyfills.cjs",
    },
  },
});

/**
 * A package root with one `./generative-ui` code entry built as `esm` / `cjs`,
 * beside the complete barrel.
 */
function packageWithEntry({ esm, cjs }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rn-entry-order-"));
  fs.cpSync(completeBarrel, path.join(root, "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist", "generative-ui"));
  fs.writeFileSync(path.join(root, "dist", "generative-ui", "index.mjs"), esm);
  fs.writeFileSync(path.join(root, "dist", "generative-ui", "index.cjs"), cjs);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      exports: {
        "./generative-ui": {
          import: "./dist/generative-ui/index.mjs",
          require: "./dist/generative-ui/index.cjs",
        },
        "./polyfills": {
          import: "./dist/polyfills.mjs",
          require: "./dist/polyfills.cjs",
        },
        "./package.json": "./package.json",
      },
    }),
  );
  return root;
}

// What tsdown emitted for the generative UI entry before it imported the
// polyfills: core-loading modules first, no polyfill barrel at all.
const UNPOLYFILLED_ESM =
  'import React from "react";\n' +
  'import { useCopilotKit } from "@copilotkit/react-core/v2/context";\n';
const UNPOLYFILLED_CJS =
  "Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n" +
  "const require_chunk = require('../chunk-C0xms8kb.cjs');\n" +
  'let react = require("react");\n';
const POLYFILLED_ESM = 'import "../polyfills.mjs";\n' + UNPOLYFILLED_ESM;
const POLYFILLED_CJS = UNPOLYFILLED_CJS.replace(
  'let react = require("react");',
  "require('../polyfills.cjs');\nlet react = require(\"react\");",
);

describe("verifyBarrel", () => {
  it("rejects the tree-shaken barrel that shipped in 1.69.2", () => {
    const report = verifyBarrel(emptyBarrel);
    assert.equal(report.ok, false);
    // Every group is gone, in both formats — not just the one that happened to
    // be noticed first.
    assert.deepEqual(
      report.esmMissing,
      GROUPS.map((g) => g.name),
    );
    for (const entry of report.cjs) {
      assert.equal(
        entry.installed.length,
        0,
        `${entry.group} should install nothing`,
      );
    }
  });

  it("accepts a barrel that reaches all five polyfill groups", () => {
    const report = verifyBarrel(completeBarrel);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.deepEqual(report.esmMissing, []);
    for (const entry of report.cjs) {
      assert.deepEqual(
        entry.missing,
        [],
        `${entry.group} should install every global`,
      );
    }
  });

  it("fails when a single group regresses, not only when all five do", () => {
    // The realistic regression is one import going missing, which is exactly
    // what a whole-barrel assertion would wave through.
    const partial = fs.mkdtempSync(path.join(os.tmpdir(), "rn-barrel-"));
    fs.cpSync(completeBarrel, partial, { recursive: true });
    fs.writeFileSync(
      path.join(partial, "polyfills.cjs"),
      fs
        .readFileSync(path.join(partial, "polyfills.cjs"), "utf8")
        .replace('require("./polyfills/crypto.cjs");\n', ""),
    );
    fs.writeFileSync(
      path.join(partial, "polyfills.mjs"),
      fs
        .readFileSync(path.join(partial, "polyfills.mjs"), "utf8")
        .replace('import "./polyfills/crypto.mjs";\n', ""),
    );

    const report = verifyBarrel(partial);
    assert.equal(report.ok, false);
    assert.deepEqual(report.esmMissing, ["crypto"]);
    assert.deepEqual(report.cjs.find((e) => e.group === "crypto").missing, [
      "crypto.getRandomValues",
    ]);
    // The other four must still read as healthy.
    for (const entry of report.cjs.filter((e) => e.group !== "crypto")) {
      assert.deepEqual(entry.missing, []);
    }
    fs.rmSync(partial, { recursive: true, force: true });
  });
});

describe("checkEntryOrder", () => {
  it("rejects a published entry that loads CopilotKit before the polyfills", () => {
    const root = packageWithEntry({
      esm: UNPOLYFILLED_ESM,
      cjs: UNPOLYFILLED_CJS,
    });
    const results = checkEntryOrder(root);
    // Both formats, and nothing for the polyfill subpath or the manifest.
    assert.deepEqual(
      results.map(({ file, first, ok }) => ({ file, first, ok })),
      [
        { file: "./dist/generative-ui/index.mjs", first: "react", ok: false },
        { file: "./dist/generative-ui/index.cjs", first: "react", ok: false },
      ],
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts an entry whose first load is the polyfill barrel", () => {
    const root = packageWithEntry({
      esm: POLYFILLED_ESM,
      cjs: POLYFILLED_CJS,
    });
    const results = checkEntryOrder(root);
    assert.equal(results.length, 2);
    for (const result of results) assert.equal(result.ok, true, result.file);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects an entry whose polyfill import is present but not first", () => {
    // The root entry's real regression: the bundler hoisted a shared chunk
    // that loads @copilotkit/react-core above the import of the polyfills.
    const root = packageWithEntry({
      esm: UNPOLYFILLED_ESM + 'import "../polyfills.mjs";\n',
      cjs: UNPOLYFILLED_CJS + "require('../polyfills.cjs');\n",
    });
    for (const result of checkEntryOrder(root)) {
      assert.equal(result.ok, false, result.file);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reports an entry that was not built instead of skipping it", () => {
    const root = packageWithEntry({ esm: POLYFILLED_ESM, cjs: POLYFILLED_CJS });
    fs.rmSync(path.join(root, "dist", "generative-ui", "index.cjs"));
    const missing = checkEntryOrder(root).find((r) => r.file.endsWith(".cjs"));
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "not built");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("firstEsmSpecifier / firstCjsSpecifier", () => {
  it("reads the first module, past comments and rolldown's runtime chunk", () => {
    assert.equal(
      firstEsmSpecifier(
        '//#region x\nimport "./polyfills.mjs";\nimport a from "a";',
      ),
      "./polyfills.mjs",
    );
    assert.equal(firstEsmSpecifier('export * from "./x.mjs";'), "./x.mjs");
    assert.equal(firstEsmSpecifier("const a = 1;"), null);
    assert.equal(firstCjsSpecifier(POLYFILLED_CJS), "../polyfills.cjs");
    assert.equal(firstCjsSpecifier(UNPOLYFILLED_CJS), "react");
  });
});

describe("missingEsmImports", () => {
  it("names every group the ESM barrel no longer imports", () => {
    assert.deepEqual(
      missingEsmImports(""),
      GROUPS.map((g) => g.name),
    );
    assert.deepEqual(
      missingEsmImports(
        GROUPS.map((g) => `import "./polyfills/${g.name}.mjs";`).join("\n"),
      ),
      [],
    );
  });
});

describe("assertBuilt", () => {
  it("tells an unbuilt package to run the build", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "rn-unbuilt-"));
    assert.throws(
      () => assertBuilt(empty),
      (error) => {
        assert.match(error.message, /Built barrel not found/);
        assert.ok(
          error.message.includes(BUILD_COMMAND),
          "should name the build command",
        );
        return true;
      },
    );
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe("isEntrypoint", () => {
  it("is false when the module is imported rather than run", () => {
    // argv[1] here is this test file, not the verifier, so the verifier's CLI
    // block must stay inert — otherwise importing it would run a real check.
    assert.equal(
      isEntrypoint(pathToFileURL(scriptPath).href, process.argv[1]),
      false,
    );
  });

  it("matches through symlinked paths", () => {
    // os.tmpdir() is /var/... on macOS but resolves to /private/var/..., so a
    // raw string compare would leave the CLI silently inert there.
    assert.equal(
      isEntrypoint(pathToFileURL(scriptPath).href, scriptPath),
      true,
    );
  });
});

describe("cli", () => {
  it("exits non-zero and explains the tree-shake when the barrel is empty", () => {
    // Point the CLI at the empty fixture by running it from a package root
    // whose dist/ is that fixture.
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-cli-"));
    fs.mkdirSync(path.join(fakeRoot, "scripts"));
    fs.cpSync(scriptPath, path.join(fakeRoot, "scripts", "verify.mjs"));
    fs.cpSync(emptyBarrel, path.join(fakeRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, "package.json"), BARREL_ONLY_MANIFEST);

    const result = spawnSync(
      process.execPath,
      [path.join(fakeRoot, "scripts", "verify.mjs")],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /sideEffects/);
    assert.match(result.stdout, /FAIL {2}cjs {2}streams/);
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  });

  it("emits a machine-readable report under --json", () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-cli-json-"));
    fs.mkdirSync(path.join(fakeRoot, "scripts"));
    fs.cpSync(scriptPath, path.join(fakeRoot, "scripts", "verify.mjs"));
    fs.cpSync(completeBarrel, path.join(fakeRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, "package.json"), BARREL_ONLY_MANIFEST);

    const result = spawnSync(
      process.execPath,
      [path.join(fakeRoot, "scripts", "verify.mjs"), "--json"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, true);
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  });

  it("fails the build when a published entry loads CopilotKit before the polyfills", () => {
    const fakeRoot = packageWithEntry({
      esm: UNPOLYFILLED_ESM,
      cjs: UNPOLYFILLED_CJS,
    });
    fs.mkdirSync(path.join(fakeRoot, "scripts"));
    fs.cpSync(scriptPath, path.join(fakeRoot, "scripts", "verify.mjs"));

    const result = spawnSync(
      process.execPath,
      [path.join(fakeRoot, "scripts", "verify.mjs")],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL {2}\.\/dist\/generative-ui\/index\.mjs +first loads react/,
    );
    assert.match(result.stderr, /expected \.\.\/polyfills\.cjs/);
    assert.match(result.stderr, /sideEffects/);
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  });
});
