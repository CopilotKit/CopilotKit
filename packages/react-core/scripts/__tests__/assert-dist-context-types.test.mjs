// Tests for scripts/assert-dist-context-types.mjs, the build gate that checks
// that the ESM and CommonJS declarations of the native and headless entries
// use the `CopilotKitCoreReact` of `/v2/context`.
//
// Each test builds a small fake package in a temp directory: a package.json
// named `@copilotkit/react-core` with an `exports` map, a hand-written `dist/`
// of `.d.cts`/`.d.mts` files, a copy of the real consumers and tsconfig from
// scripts/dist-context-types/, and a copy of the script itself. The script
// finds `dist/` and the consumers relative to its own location, so the copy
// checks the fixture, not the real build. `node_modules/typescript` is a thin
// package that forwards to the real TypeScript, so a test can swap in a fake
// `tsc` to make it print what a real one rarely does.
//
// Set ASSERT_DIST_CONTEXT_TYPES_SCRIPT to run the suite against another copy
// of the script (used to show which tests fail on an older version).
//
// Invoked from package.json `test:scripts`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SCRIPT =
  process.env.ASSERT_DIST_CONTEXT_TYPES_SCRIPT ??
  path.resolve(here, "../assert-dist-context-types.mjs");
const REAL_CONSUMERS = path.resolve(here, "../dist-context-types");
const REAL_TS = require.resolve("typescript");
const REAL_TSC = require.resolve("typescript/bin/tsc");

const PKG = "@copilotkit/react-core";
const NATIVE = `${PKG}/v2/generative-ui/native`;
const HEADLESS = `${PKG}/v2/headless`;
const CONTEXT = `${PKG}/v2/context`;
const EXTS = ["cts", "mts"];
const js = (ext) => (ext === "cts" ? "cjs" : "mjs");

const CLASS_BODY = `{
  private _renderToolCalls;
  private _hooks;
  run(): void;
}`;

const exportsEntry = (sub) => ({
  import: { types: `./dist/${sub}.d.mts`, default: `./dist/${sub}.mjs` },
  require: { types: `./dist/${sub}.d.cts`, default: `./dist/${sub}.cjs` },
});

// The files of a fixture package that passes: `{ relativePath: content }`.
const baseFiles = () => {
  const files = {
    "package.json": JSON.stringify(
      {
        name: PKG,
        version: "0.0.0",
        exports: {
          "./v2/context": exportsEntry("v2/context"),
          "./v2/headless": exportsEntry("v2/headless"),
          "./v2/generative-ui/native": exportsEntry("v2/generative-ui/native"),
        },
      },
      null,
      2,
    ),
  };
  for (const ext of EXTS) {
    files[`dist/v2/context.d.${ext}`] =
      `declare class CopilotKitCoreReact ${CLASS_BODY}\nexport { CopilotKitCoreReact };\n`;
    files[`dist/v2/headless.d.${ext}`] =
      `import { CopilotKitCoreReact } from "${CONTEXT}";\nexport { CopilotKitCoreReact };\n`;
    files[`dist/v2/generative-ui/native.d.${ext}`] =
      `import { CopilotKitCoreReact } from "${CONTEXT}";\n` +
      "declare function useGenerativeUIRoot(copilotkit: CopilotKitCoreReact, config: unknown): { ready: boolean };\n" +
      "export { useGenerativeUIRoot };\n";
  }
  for (const name of fs.readdirSync(REAL_CONSUMERS)) {
    files[`scripts/dist-context-types/${name}`] = fs.readFileSync(
      path.join(REAL_CONSUMERS, name),
      "utf8",
    );
  }
  return files;
};

const forBoth = (make) =>
  Object.fromEntries(EXTS.flatMap((ext) => Object.entries(make(ext))));

// Writes a fixture package. `files` overrides the base files (null deletes
// one); `tsc` replaces the body of `typescript/bin/tsc`.
const fixture = ({ files = {}, tsc } = {}) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dist-context-types-")),
  );
  const all = { ...baseFiles(), ...files };
  all["scripts/assert-dist-context-types.mjs"] = fs.readFileSync(
    SCRIPT,
    "utf8",
  );
  all["node_modules/typescript/package.json"] = JSON.stringify({
    name: "typescript",
    version: "0.0.0-fixture",
    main: "index.js",
  });
  all["node_modules/typescript/index.js"] =
    `module.exports = require(${JSON.stringify(REAL_TS)});\n`;
  all["node_modules/typescript/bin/tsc"] =
    tsc ?? `require(${JSON.stringify(REAL_TSC)});\n`;
  for (const [file, content] of Object.entries(all)) {
    if (content === null) continue;
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

const run = (options = {}, env = {}) => {
  const root = fixture(options);
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/assert-dist-context-types.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ASSERT_DIST_CONTEXT_TYPES_TIMEOUT_MS: undefined,
          ...env,
        },
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    return {
      status: result.status,
      out: `${result.stdout}${result.stderr}`,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

// The script reports through `fail()`, never through an uncaught exception.
const assertNoCrash = (out) => {
  assert.doesNotMatch(out, /TypeError|RangeError|ERR_OUT_OF_RANGE/);
  assert.doesNotMatch(out, /\n\s+at .+:\d+:\d+\)?\n/);
};

const ANNOTATION_HINT = /An export of the native entry must name/;

// The body of a fake `tsc` that prints `text` and exits with `status`.
// fs.writeSync: process.stdout.write to a pipe is asynchronous on macOS, and
// process.exit would cut the output short.
const fakeTsc = (text, status) =>
  `require("fs").writeSync(1, ${JSON.stringify(text)});\nprocess.exit(${status});\n`;

// A consumer that imports the given lines and runs the given statements, the
// same in both module modes.
const consumer = (lines) =>
  [
    `import type { CopilotKitCoreReact } from "${CONTEXT}";`,
    `import type { CopilotKitCoreReact as HeadlessCopilotKitCoreReact } from "${HEADLESS}";`,
    ...lines,
    `export const headless: HeadlessCopilotKitCoreReact = core;`,
    "",
  ].join("\n");

describe("assert-dist-context-types", () => {
  it("passes when both entries use the class of /v2/context", () => {
    const { status, out } = run();
    assert.equal(status, 0, out);
    assert.match(out, /OK/);
  });

  it("passes when /v2/context re-exports the class from a shared chunk", () => {
    const { status, out } = run({
      files: forBoth((ext) => ({
        [`dist/v2/chunk-core.d.${ext}`]: `declare class CopilotKitCoreReact ${CLASS_BODY}\nexport { CopilotKitCoreReact };\n`,
        [`dist/v2/context.d.${ext}`]: `import { CopilotKitCoreReact } from "./chunk-core.${js(ext)}";\nexport { CopilotKitCoreReact };\n`,
      })),
    });
    assert.equal(status, 0, out);
  });

  describe("a second declaration of the class", () => {
    it("is reported in the native entry, with the annotation hint", () => {
      const { status, out } = run({
        files: {
          "dist/v2/generative-ui/native.d.cts":
            `declare class CopilotKitCoreReact$1 ${CLASS_BODY}\n` +
            "declare function useGenerativeUIRoot(copilotkit: CopilotKitCoreReact$1, config: unknown): { ready: boolean };\n" +
            "export { useGenerativeUIRoot };\n",
        },
      });
      assert.equal(status, 1, out);
      assert.match(
        out,
        /CommonJS \(\.d\.cts\): `useGenerativeUIRoot` of @copilotkit\/react-core\/v2\/generative-ui\/native uses a second declaration of the class, `CopilotKitCoreReact\$1`/,
      );
      assert.match(out, /CommonJS: tsdown emits/);
      assert.match(out, ANNOTATION_HINT);
    });

    it("is reported in the headless entry without the native-only hint", () => {
      const { status, out } = run({
        files: {
          "dist/v2/headless.d.mts":
            `declare class CopilotKitCoreReact$1 ${CLASS_BODY}\n` +
            "export { CopilotKitCoreReact$1 as CopilotKitCoreReact };\n",
        },
      });
      assert.equal(status, 1, out);
      assert.match(
        out,
        /ESM \(\.d\.mts\): `CopilotKitCoreReact` of @copilotkit\/react-core\/v2\/headless uses a second declaration of the class/,
      );
      assert.match(out, /separate declarations of a private property/);
      assert.match(out, /ESM: the `\.d\.mts` files take/);
      assert.doesNotMatch(out, ANNOTATION_HINT);
    });

    it("is found when renamed other than `$N`", () => {
      const { status, out } = run({
        files: {
          "dist/v2/generative-ui/native.d.cts":
            `declare class CopilotKitCoreReact_1 ${CLASS_BODY}\n` +
            "declare function useGenerativeUIRoot(copilotkit: CopilotKitCoreReact_1, config: unknown): { ready: boolean };\n" +
            "export { useGenerativeUIRoot };\n",
          // A copy under an unrelated name, carried by an export the
          // consumers do not import.
          "dist/v2/generative-ui/native.d.mts":
            `import { CopilotKitCoreReact } from "${CONTEXT}";\n` +
            `declare class BundledCore ${CLASS_BODY}\n` +
            "declare function useGenerativeUIRoot(copilotkit: CopilotKitCoreReact, config: unknown): { ready: boolean };\n" +
            "declare function useBundled(core: BundledCore): void;\n" +
            "export { useGenerativeUIRoot, useBundled };\n",
        },
      });
      assert.equal(status, 1, out);
      assert.match(
        out,
        /`useGenerativeUIRoot` of \S+native uses a second declaration of the class, `CopilotKitCoreReact_1`/,
      );
      assert.match(
        out,
        /`useBundled` of \S+native uses a second declaration of the class, `BundledCore`/,
      );
      assert.match(out, /does not check them: useBundled\./);
    });
  });

  it("reports missing built declarations", () => {
    const { status, out } = run({
      files: { "dist/v2/headless.d.cts": null },
    });
    assert.equal(status, 1, out);
    assert.match(
      out,
      /built declarations are missing:\n\s+dist\/v2\/headless\.d\.cts/,
    );
    assertNoCrash(out);
  });

  it("reports a missing consumer instead of crashing", () => {
    const { status, out } = run({
      files: { "scripts/dist-context-types/consumer.cts": null },
    });
    assert.equal(status, 1, out);
    assert.match(out, /scripts\/dist-context-types\/consumer\.cts/);
    assert.match(out, /missing/);
    assertNoCrash(out);
  });

  it("reports an error in the consumers' tsconfig before running", () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(REAL_CONSUMERS, "tsconfig.json"), "utf8"),
    );
    tsconfig.compilerOptions.notAnOption = true;
    const { status, out } = run({
      files: {
        "scripts/dist-context-types/tsconfig.json": JSON.stringify(tsconfig),
      },
    });
    assert.equal(status, 1, out);
    assert.match(out, /scripts\/dist-context-types\/tsconfig\.json has errors/);
    assert.match(out, /TS5023/);
    assertNoCrash(out);
  });

  describe("tsc output", () => {
    it("keeps a diagnostic without a file location apart, with its own cause", () => {
      const { status, out } = run({
        tsc: fakeTsc(
          "scripts/dist-context-types/consumer.mts(15,24): error TS2345: Argument of type 'CopilotKitCoreReact' is not assignable to parameter of type 'CopilotKitCoreReact'.\n" +
            "  Types have separate declarations of a private property '_renderToolCalls'.\n" +
            "error TS5083: Cannot read file '/nowhere/tsconfig.base.json'.\n",
          2,
        ),
      });
      assert.equal(status, 1, out);
      assert.match(out, /the `\/v2\/context` instance is not assignable/);
      assert.match(out, /no file location/);
    });

    it("says why when tsc fails and prints nothing", () => {
      const { status, out } = run({ tsc: "process.exit(3);\n" });
      assert.equal(status, 1, out);
      assert.match(out, /exited with status 3/);
      assert.match(out, /printed nothing/);
    });

    it("reports more than 1 MiB of output as a failure, not as a flaky run", () => {
      const line =
        "scripts/dist-context-types/consumer.mts(15,24): error TS2322: Type 'string' is not assignable to type 'number'.\n";
      const { status, out } = run({
        tsc: fakeTsc(
          line.repeat(Math.ceil((2 * 1024 * 1024) / line.length)),
          2,
        ),
      });
      assert.equal(status, 1, out);
      assert.doesNotMatch(out, /could not run|run .* again/);
      assert.match(out, /tsc on scripts\/dist-context-types failed/);
    });
  });

  describe("ASSERT_DIST_CONTEXT_TYPES_TIMEOUT_MS", () => {
    for (const value of ["-1", "0", "abc", "1.5"]) {
      it(`rejects ${JSON.stringify(value)} with a message`, () => {
        const { status, out } = run(
          {},
          { ASSERT_DIST_CONTEXT_TYPES_TIMEOUT_MS: value },
        );
        assert.equal(status, 1, out);
        assert.match(
          out,
          /ASSERT_DIST_CONTEXT_TYPES_TIMEOUT_MS must be a positive whole number/,
        );
        assertNoCrash(out);
      });
    }
  });

  it("reports an import in the headless entry that does not resolve", () => {
    const { status, out } = run({
      files: {
        "dist/v2/headless.d.mts":
          'import { CopilotKitCoreReact } from "./chunk-gone.mjs";\nexport { CopilotKitCoreReact };\n',
      },
    });
    assert.equal(status, 1, out);
    assert.match(
      out,
      /ESM \(\.d\.mts\): @copilotkit\/react-core\/v2\/headless: "\.\/chunk-gone\.mjs" in dist\/v2\/headless\.d\.mts does not resolve/,
    );
  });

  describe("the consumers' imports", () => {
    const twoCarriers = forBoth((ext) => ({
      [`dist/v2/generative-ui/native.d.${ext}`]:
        `import { CopilotKitCoreReact } from "${CONTEXT}";\n` +
        "declare function useGenerativeUIRoot(copilotkit: CopilotKitCoreReact, config: unknown): { ready: boolean };\n" +
        "declare function useCore(core: CopilotKitCoreReact): void;\n" +
        "export { useGenerativeUIRoot, useCore };\n",
    }));

    it("merge two imports of the same entry", () => {
      const source = consumer([
        `import { useGenerativeUIRoot } from "${NATIVE}";`,
        `import { useCore } from "${NATIVE}";`,
        "declare const core: CopilotKitCoreReact;",
        "export const runtime = useGenerativeUIRoot(core, undefined);",
        "useCore(core);",
      ]);
      const { status, out } = run({
        files: {
          ...twoCarriers,
          "scripts/dist-context-types/consumer.cts": source,
          "scripts/dist-context-types/consumer.mts": source,
        },
      });
      assert.equal(status, 0, out);
    });

    it("count a default import and the members used through a namespace import", () => {
      const source = consumer([
        `import useDefault, * as native from "${NATIVE}";`,
        "declare const core: CopilotKitCoreReact;",
        "export const runtime = native.useGenerativeUIRoot(core, undefined);",
        "useDefault(core);",
      ]);
      const { status, out } = run({
        files: {
          ...forBoth((ext) => ({
            [`dist/v2/generative-ui/native.d.${ext}`]:
              `import { CopilotKitCoreReact } from "${CONTEXT}";\n` +
              "declare function useGenerativeUIRoot(copilotkit: CopilotKitCoreReact, config: unknown): { ready: boolean };\n" +
              "declare function useDefault(core: CopilotKitCoreReact): void;\n" +
              "export { useGenerativeUIRoot, useDefault as default };\n",
          })),
          "scripts/dist-context-types/consumer.cts": source,
          "scripts/dist-context-types/consumer.mts": source,
        },
      });
      assert.equal(status, 0, out);
    });

    it("tell an import the entry no longer exports from one that lost the class", () => {
      const source = consumer([
        `import { useGenerativeUIRoot, useGone } from "${NATIVE}";`,
        "declare const core: CopilotKitCoreReact;",
        "export const runtime = useGenerativeUIRoot(core, undefined);",
        "useGone(core);",
      ]);
      const { status, out } = run({
        files: {
          "scripts/dist-context-types/consumer.cts": source,
          "scripts/dist-context-types/consumer.mts": source,
        },
      });
      assert.equal(status, 1, out);
      assert.match(
        out,
        /imports useGone from \S+native, which no longer exports it/,
      );
      assert.doesNotMatch(out, /useGone[^\n]*lost the type/);
    });
  });
});
