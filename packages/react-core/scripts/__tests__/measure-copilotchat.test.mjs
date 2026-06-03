// Standalone Node test (not vitest) — the script under test calls esbuild,
// which trips vitest's jsdom env probe, and the package-wide vitest setup uses
// jsdom-only globals. Running with `node --test` keeps this isolated.
//
// Invoked from package.json `test:scripts` and the chained `test` command.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { measureBundle } from "../measure-copilotchat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures");
const fixtureEntry = path.join(fixtureDir, "tiny-entry.js");

describe("measureBundle", () => {
  it("bundles a tiny CopilotChat fixture and returns a positive gzip total", async () => {
    const result = await measureBundle({
      entryModule: fixtureEntry,
      pkgRoot: fixtureDir,
    });
    assert.ok(result.totalBytes > 0, "totalBytes should be > 0");
    // Trivial fixture; a sane upper bound guards against accidental inclusion
    // of huge externals or the loader stubs regressing.
    assert.ok(
      result.totalBytes < 50_000,
      `totalBytes should be < 50_000, got ${result.totalBytes}`,
    );
    assert.ok(result.outputCount >= 1, "outputCount should be >= 1");
  });

  it("returns a deterministic gzip total across two runs", async () => {
    const a = await measureBundle({
      entryModule: fixtureEntry,
      pkgRoot: fixtureDir,
    });
    const b = await measureBundle({
      entryModule: fixtureEntry,
      pkgRoot: fixtureDir,
    });
    assert.equal(b.totalBytes, a.totalBytes);
  });
});
