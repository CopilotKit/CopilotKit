/**
 * generate-spec-cell-mapping --check freshness gate test.
 *
 * The `serializeBase()` helper is already covered by
 * `spec-cell-mapping.base.test.ts` (byte-match + content contracts).
 * This file covers the CLI `--check` seam: the `checkFreshness()` function
 * that `main()` delegates to, and the full subprocess exit-code path.
 *
 * Two contracts:
 *   RED  — a stale base (key removed vs REGISTRY_TO_D5) makes checkFreshness
 *          return false, and spawning --check exits non-zero with
 *          "stale-base-mapping" on stderr.
 *   GREEN — a fresh base (byte-identical to serializeBase(REGISTRY_TO_D5))
 *           makes checkFreshness return true, and spawning --check exits 0.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REGISTRY_TO_D5 } from "./d5-feature-mapping.js";
import { serializeBase, checkFreshness } from "../../../scripts/generate-spec-cell-mapping.js";

const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT_PATH = join(HARNESS_ROOT, "scripts", "generate-spec-cell-mapping.ts");
const TSX_BIN = join(HARNESS_ROOT, "node_modules", ".bin", "tsx");
const BASE_PATH = join(HARNESS_ROOT, "src", "probes", "helpers", "spec-cell-mapping.base.json");

// ---------------------------------------------------------------------------
// checkFreshness() — pure logic seam (no subprocess)
// ---------------------------------------------------------------------------

describe("checkFreshness() — stale vs fresh base", () => {
  it("RED: returns false when base has a key removed (stale)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "scm-check-"));
    const stalePath = join(tmp, "stale-base.json");

    // Build a stale map by dropping the first key from REGISTRY_TO_D5.
    const staleMap: Record<string, string[]> = {};
    const keys = Object.keys(REGISTRY_TO_D5).sort();
    for (const k of keys.slice(1)) staleMap[k] = [...REGISTRY_TO_D5[k]];
    writeFileSync(stalePath, JSON.stringify(staleMap, null, 2) + "\n");

    expect(checkFreshness(stalePath)).toBe(false);
  });

  it("RED: returns false when base has an extra key (stale)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "scm-check-"));
    const stalePath = join(tmp, "stale-base.json");

    // Build a stale map by adding a phantom key not in REGISTRY_TO_D5.
    const staleMap: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(REGISTRY_TO_D5)) staleMap[k] = [...v];
    staleMap["__phantom-key-for-test__"] = ["phantom-cell"];
    writeFileSync(stalePath, JSON.stringify(staleMap, null, 2) + "\n");

    expect(checkFreshness(stalePath)).toBe(false);
  });

  it("GREEN: returns true when base is byte-identical to serializeBase(REGISTRY_TO_D5)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "scm-check-"));
    const freshPath = join(tmp, "fresh-base.json");
    writeFileSync(freshPath, serializeBase(REGISTRY_TO_D5));

    expect(checkFreshness(freshPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// subprocess --check — full argv / process.exit seam (as CI runs it)
// ---------------------------------------------------------------------------

describe("--check subprocess exit-code seam", () => {
  it("GREEN: exits 0 when committed base.json is fresh", () => {
    // The committed base.json must always be fresh on this branch; if it
    // were stale the CI gate (ci(showcase): additive generator --check step)
    // would have already failed.  This assertion is the end-to-end green proof.
    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync(TSX_BIN, [SCRIPT_PATH, "--check"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const spawnErr = err as { status?: number; stderr?: string };
      exitCode = spawnErr.status ?? 1;
      stderr = spawnErr.stderr ?? "";
    }
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("stale-base-mapping");
  });

  it("RED: exits non-zero and reports stale-base-mapping when base is stale", () => {
    // Write a stale base.json (key removed), swap it in, run --check, restore.
    const committed = readFileSync(BASE_PATH, "utf-8");

    const staleMap: Record<string, string[]> = {};
    const keys = Object.keys(REGISTRY_TO_D5).sort();
    for (const k of keys.slice(1)) staleMap[k] = [...REGISTRY_TO_D5[k]];
    const staleContent = JSON.stringify(staleMap, null, 2) + "\n";

    // Swap, run, restore — always restore via try/finally.
    writeFileSync(BASE_PATH, staleContent);
    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync(TSX_BIN, [SCRIPT_PATH, "--check"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const spawnErr = err as { status?: number; stderr?: string };
      exitCode = spawnErr.status ?? 1;
      stderr = spawnErr.stderr ?? "";
    } finally {
      writeFileSync(BASE_PATH, committed);
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("stale-base-mapping");
  });
});
