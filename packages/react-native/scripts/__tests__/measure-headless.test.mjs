// Standalone Node test (not vitest) — the script under test calls esbuild,
// which trips vitest's jsdom env probe, and the package-wide vitest setup uses
// jsdom-only globals. Running with `node --test` keeps this isolated. This
// mirrors react-core's scripts/__tests__/measure-copilotchat.test.mjs.
//
// Invoked from package.json `test:scripts` and the chained `test` command.
//
// What this locks down: measure-headless.mjs prints the number that a bundle
// claim rests on, so its FAILURE modes are the thing worth testing — a zero or
// implausible total must be rejected, esbuild warnings must survive
// `logLevel: "silent"`, and an unbuilt package must say "run the build".
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
  BUILT_ENTRY_FILE,
  HEADLESS_EXTERNAL,
  implausibleTotalReason,
  isEntrypoint,
  measureHeadlessBundle,
  MIN_PLAUSIBLE_BYTES,
} from "../measure-headless.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures");
const tinyEntry = path.join(fixtureDir, "tiny-headless.js");
const warningEntry = path.join(fixtureDir, "warning-headless.js");
const strayReactDomEntry = path.join(fixtureDir, "stray-react-dom-headless.js");

describe("measureHeadlessBundle", () => {
  it("bundles a tiny headless fixture and returns a positive gzip total", async () => {
    const result = await measureHeadlessBundle({
      pkgRoot: fixtureDir,
      entry: tinyEntry,
    });
    assert.ok(result.totalBytes > 0, "totalBytes should be > 0");
    assert.ok(result.outputCount >= 1, "outputCount should be >= 1");
    assert.equal(result.warnings.length, 0);
  });

  it("returns a deterministic gzip total across two runs", async () => {
    const a = await measureHeadlessBundle({
      pkgRoot: fixtureDir,
      entry: tinyEntry,
    });
    const b = await measureHeadlessBundle({
      pkgRoot: fixtureDir,
      entry: tinyEntry,
    });
    assert.equal(b.totalBytes, a.totalBytes);
  });

  it("surfaces esbuild warnings instead of swallowing them", async () => {
    const { warnings } = await measureHeadlessBundle({
      pkgRoot: fixtureDir,
      entry: warningEntry,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].text, /Duplicate key/);
  });

  it("throws with esbuild's error text and the build command when the entry does not resolve", async () => {
    await assert.rejects(
      () =>
        measureHeadlessBundle({
          pkgRoot: fixtureDir,
          entry: "@copilotkit/react-native/definitely-not-an-entry",
        }),
      (error) => {
        assert.match(error.message, /Could not resolve/);
        assert.ok(
          error.message.includes(BUILD_COMMAND),
          `error should name the build command, got:\n${error.message}`,
        );
        return true;
      },
    );
  });
});

describe("HEADLESS_EXTERNAL", () => {
  it("externalizes the host-provided packages, react-dom included", () => {
    // react-dom is the defensive one: it is not reachable from the headless
    // entry today, so nothing else would notice if it were dropped, and a
    // later stray edge would silently inflate the reported figure.
    for (const pkg of ["react", "react-native", "react-dom"]) {
      assert.ok(
        HEADLESS_EXTERNAL.includes(pkg),
        `${pkg} must stay external — it is provided by the host app, so bundling it would measure the host's cost, not ours. Got: ${HEADLESS_EXTERNAL.join(", ")}`,
      );
    }
  });

  it("keeps a stray react-dom/client edge out of the measured graph", async () => {
    // A/B over the same fixture: the only difference is whether react-dom is
    // externalized. This is what makes the react-dom entry load-bearing rather
    // than decorative — and it also proves esbuild's package-path prefix match
    // covers the /client subpath without an entry of its own.
    const guarded = await measureHeadlessBundle({
      pkgRoot: fixtureDir,
      entry: strayReactDomEntry,
    });
    const unguarded = await measureHeadlessBundle({
      pkgRoot: fixtureDir,
      entry: strayReactDomEntry,
      external: HEADLESS_EXTERNAL.filter((pkg) => pkg !== "react-dom"),
    });

    assert.ok(
      unguarded.totalBytes > guarded.totalBytes * 5,
      `dropping react-dom from external should visibly inflate the figure, ` +
        `but guarded=${guarded.totalBytes} B and unguarded=${unguarded.totalBytes} B`,
    );
  });
});

describe("implausibleTotalReason", () => {
  it("rejects a zero total — the '0.0 kB looks like a huge win' failure", () => {
    assert.match(implausibleTotalReason(0), /no output/);
  });

  it("rejects a total under the plausibility floor", () => {
    const reason = implausibleTotalReason(MIN_PLAUSIBLE_BYTES - 1);
    assert.match(reason, /plausibility floor/);
  });

  it("accepts a realistic headless total", () => {
    assert.equal(implausibleTotalReason(92 * 1024), null);
  });

  it("rejects a total that rounds to the misleading 0.0 kB print", () => {
    // An empty bundle measures ~20-35 B (the gzip envelope alone), which
    // renders as "0.0 kB" at one decimal place — the headline failure. A
    // zero-only guard would let this through, so assert the floor catches it.
    assert.ok(implausibleTotalReason(33) !== null);
  });
});

describe("assertBuilt", () => {
  it("names the build command when the built entry is missing", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-unbuilt-"));
    try {
      assert.throws(
        () => assertBuilt(emptyRoot),
        (error) => {
          assert.match(error.message, /dist\/headless\.mjs is missing/);
          assert.ok(
            error.message.includes(BUILD_COMMAND),
            `error should name the build command, got:\n${error.message}`,
          );
          return true;
        },
      );
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("passes once the built entry exists", () => {
    const builtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-built-"));
    try {
      const built = path.join(builtRoot, BUILT_ENTRY_FILE);
      fs.mkdirSync(path.dirname(built), { recursive: true });
      fs.writeFileSync(built, "export {};\n");
      assert.doesNotThrow(() => assertBuilt(builtRoot));
    } finally {
      fs.rmSync(builtRoot, { recursive: true, force: true });
    }
  });
});

// This script only prints its number if its CLI block actually RUNS. The first
// version of that guard compared `import.meta.url` to a `file://`-concatenated
// `process.argv[1]`, which is false whenever the checkout path needs URL encoding
// (a SPACE) or is reached through a symlink — so the script exited 0 having
// measured nothing. Same cover as react-core's assert-headless-purity.test.mjs.
describe("isEntrypoint (the CLI entry guard)", () => {
  /** A real file under a real directory whose name contains a space. */
  const withSpaceFixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rn-entry-guard-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rn-entry-guard-cli-"));
    const alias = path.join(root, "react native with space");
    fs.symlinkSync(path.resolve(here, "../.."), alias, "dir");
    let result;
    try {
      result = spawnSync(
        process.execPath,
        [path.join(alias, "scripts", "measure-headless.mjs")],
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
      "the CLI block printed nothing — the entry guard skipped the measurement",
    );
    // State-agnostic: a built package prints the gzip figure for the headless
    // entry, an unbuilt one names dist/headless.mjs as missing. Either proves the
    // main block ran.
    assert.match(output, /headless/);
  });
});
