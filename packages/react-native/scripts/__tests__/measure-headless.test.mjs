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
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertBuilt,
  BUILD_COMMAND,
  BUILT_ENTRY_FILE,
  implausibleTotalReason,
  measureHeadlessBundle,
  MIN_PLAUSIBLE_BYTES,
} from "../measure-headless.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures");
const tinyEntry = path.join(fixtureDir, "tiny-headless.js");
const warningEntry = path.join(fixtureDir, "warning-headless.js");

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
