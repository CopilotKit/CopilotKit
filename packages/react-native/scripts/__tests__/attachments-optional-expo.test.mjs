// Standalone Node test (not vitest) — it drives real tsdown builds, which
// don't work inside the package-wide jsdom vitest environment. Same approach
// as react-core's scripts/__tests__/measure-copilotchat.test.mjs.
//
// The expo attachment modules are optional peers: if they appear as static
// imports in the published build, Metro resolves them at bundle time and
// bare RN apps (no Expo installed) fail to build or crash at startup. They
// may only be reached through a runtime import opaque to static analysis.
//
// Invoked from package.json `test:bundle` and the chained `test` command.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const EXPO_MODULES = ["expo-document-picker", "expo-file-system"];

// Static references Metro would try to resolve at bundle time:
//   import ... from "expo-document-picker"   (ESM)
//   require("expo-document-picker")          (CJS)
//   import("expo-document-picker")           (literal dynamic import,
//   including a constant-folded template literal)
const staticReferencePattern = (moduleName) =>
  new RegExp(
    `(from\\s*|require\\(\\s*|import\\(\\s*)["'\`]${moduleName}["'\`]`,
  );

const tempDirs = [];
after(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Bundle a src entry with the package's real build config and return the
 * concatenated output per format. */
async function bundleEntry(entry) {
  const outDir = await mkdtemp(path.join(pkgRoot, ".bundle-test-"));
  tempDirs.push(outDir);
  await build({
    config: path.join(pkgRoot, "tsdown.config.ts"),
    entry: [path.join(pkgRoot, entry)],
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: false,
    outDir,
    silent: true,
  });
  const files = (await readdir(outDir)).filter(
    (f) => f.endsWith(".mjs") || f.endsWith(".cjs"),
  );
  assert.ok(files.length > 0, `expected emitted output for ${entry}`);
  let combined = "";
  for (const file of files) {
    combined += await readFile(path.join(outDir, file), "utf8");
  }
  return combined;
}

describe("expo attachment modules stay out of static analysis", () => {
  it("main entry has no static expo import", async () => {
    const combined = await bundleEntry("src/index.ts");
    for (const moduleName of EXPO_MODULES) {
      assert.ok(
        !staticReferencePattern(moduleName).test(combined),
        `${moduleName} is statically imported in the build — Metro will ` +
          `try to resolve it at bundle time and bare RN apps will break`,
      );
    }
  });

  it("main entry still wires the lazy runtime loaders", async () => {
    const combined = await bundleEntry("src/index.ts");
    for (const moduleName of EXPO_MODULES) {
      assert.ok(
        new RegExp(`["'\`]${moduleName}["'\`]`).test(combined),
        `${moduleName} is no longer referenced at all — the lazy ` +
          `attachment loaders appear to be gone`,
      );
    }
  });
});
