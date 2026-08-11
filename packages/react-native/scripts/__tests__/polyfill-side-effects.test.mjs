// Standalone Node test (not vitest) — it drives real tsdown builds, which
// don't work inside the package-wide jsdom vitest environment. Same approach
// as react-core's scripts/__tests__/measure-copilotchat.test.mjs.
//
// tsdown honours package.json `sideEffects` when bundling src -> dist: if the
// src files are not listed, the bare polyfill imports are tree-shaken out of
// the published build and the polyfills never run on React Native.
//
// Invoked from package.json `test:bundle` and the chained `test` command.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "tsdown";

const execFileAsync = promisify(execFile);
const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// One stable marker per side-effect module. If tree-shaking drops a module,
// its marker disappears from every emitted chunk.
const SIDE_EFFECT_MARKERS = {
  "polyfills/streams": "web-streams-polyfill",
  "polyfills/encoding": "text-encoding",
  "polyfills/crypto": "crypto.getRandomValues polyfill",
  "polyfills/dom": "DOMException",
  "polyfills/location": "react-native.invalid",
  "streaming-fetch": "installStreamingFetch",
};

// Temp dirs live inside the package so that externalized bare imports
// (web-streams-polyfill, text-encoding) resolve when the built output is
// imported at runtime.
const tempDirs = [];
async function makeOutDir() {
  const dir = await mkdtemp(path.join(pkgRoot, ".bundle-test-"));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Bundle a src entry with the package's real build config and return the
 * concatenated ESM output plus the outDir. */
async function bundleEntry(entry, { noExternal } = {}) {
  const outDir = await makeOutDir();
  await build({
    config: path.join(pkgRoot, "tsdown.config.ts"),
    entry: [path.join(pkgRoot, entry)],
    format: ["esm"],
    dts: false,
    sourcemap: false,
    outDir,
    silent: true,
    ...(noExternal ? { noExternal } : {}),
  });
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".mjs"));
  assert.ok(files.length > 0, `expected emitted .mjs files for ${entry}`);
  let combined = "";
  for (const file of files) {
    combined += await readFile(path.join(outDir, file), "utf8");
  }
  return { combined, outDir, files };
}

describe("package.json sideEffects keeps polyfills in the build", () => {
  it("polyfills entry retains every side-effect module", async () => {
    const { combined } = await bundleEntry("src/polyfills.ts");
    for (const [module, marker] of Object.entries(SIDE_EFFECT_MARKERS)) {
      assert.ok(
        combined.includes(marker),
        `src/${module} was tree-shaken out of the polyfills bundle ` +
          `(marker "${marker}" missing) — check package.json sideEffects`,
      );
    }
  });

  it("main entry auto-installs the polyfills", async () => {
    const { combined } = await bundleEntry("src/index.ts");
    for (const [module, marker] of Object.entries(SIDE_EFFECT_MARKERS)) {
      assert.ok(
        combined.includes(marker),
        `src/${module} was tree-shaken out of the main bundle ` +
          `(marker "${marker}" missing) — check package.json sideEffects`,
      );
    }
  });

  it("built polyfills bundle installs the globals at runtime", async () => {
    // The polyfill backends are inlined for this probe: they are CJS packages,
    // and Node's ESM loader cannot named-import them the way Metro can.
    const { outDir, files } = await bundleEntry("src/polyfills.ts", {
      noExternal: ["text-encoding", "web-streams-polyfill"],
    });
    const entryFile = files.find((f) => f === "polyfills.mjs") ?? files[0];
    const builtUrl = pathToFileURL(path.join(outDir, entryFile)).href;

    // Simulate a bare JS runtime without the web globals, import the built
    // bundle, and report which globals got installed.
    const probePath = path.join(outDir, "runtime-probe.mjs");
    await writeFile(
      probePath,
      [
        "delete globalThis.crypto;",
        "delete globalThis.ReadableStream;",
        "delete globalThis.WritableStream;",
        "delete globalThis.TransformStream;",
        "delete globalThis.TextEncoder;",
        "delete globalThis.TextDecoder;",
        "delete globalThis.DOMException;",
        `await import(${JSON.stringify(builtUrl)});`,
        "process.stdout.write(JSON.stringify({",
        '  getRandomValues: typeof globalThis.crypto?.getRandomValues === "function",',
        '  ReadableStream: typeof globalThis.ReadableStream === "function",',
        '  WritableStream: typeof globalThis.WritableStream === "function",',
        '  TransformStream: typeof globalThis.TransformStream === "function",',
        '  TextEncoder: typeof globalThis.TextEncoder === "function",',
        '  TextDecoder: typeof globalThis.TextDecoder === "function",',
        '  DOMException: typeof globalThis.DOMException === "function",',
        "}));",
      ].join("\n"),
    );

    const { stdout } = await execFileAsync(process.execPath, [probePath], {
      cwd: pkgRoot,
    });
    const installed = JSON.parse(stdout);
    for (const [globalName, present] of Object.entries(installed)) {
      assert.ok(
        present,
        `importing the built polyfills bundle did not install ${globalName}`,
      );
    }
  });
});
