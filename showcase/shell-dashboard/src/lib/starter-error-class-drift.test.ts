/**
 * Cross-package contract drift test — the dashboard's hand-copied starter
 * FAILURE-CLASS taxonomy vs the authoritative harness `StarterFailureClass`.
 *
 * WHY THIS EXISTS: the dashboard carries a STRUCTURAL COPY of the harness
 * starter-smoke `errorClass` taxonomy (`STARTER_FAILURE_CLASSES`,
 * `StarterFailureClass`) in `live-status.ts`, because it imports only `@/*` and
 * never reaches across the package boundary into harness source at runtime
 * (same rule that makes `STARTER_COLUMNS` a local copy of a harness producer
 * constant, and the comm-error contract a local mirror guarded by
 * `commError-contract-drift.test.ts`). The harness OWNS the producer side that
 * stamps `errorClass` onto starter rows; the dashboard mirrors the read
 * vocabulary so its two-miss tolerance (pool-fleet step C) can classify
 * soft-vs-hard. If the harness adds / renames / removes a failure class, this
 * test reds so the soft-vs-hard split can never silently diverge.
 *
 * The harness lives in a SEPARATE npm workspace (`showcase/harness`), so the
 * dashboard cannot import across the package boundary. We parse the harness
 * source via `fs` (mirroring `commError-contract-drift.test.ts` and
 * `starter-column-equality.test.ts`), reading the authoritative
 * `StarterFailureClass` union members directly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STARTER_FAILURE_CLASSES } from "./live-status";

const HARNESS_STARTER_SMOKE_FILE = resolve(
  __dirname,
  "../../../harness/src/probes/drivers/starter-smoke.ts",
);

function harnessSource(): string {
  return readFileSync(HARNESS_STARTER_SMOKE_FILE, "utf8");
}

/**
 * Parse the string-literal members of the harness `StarterFailureClass` union.
 * Throws if the block can't be located so a shape change is loud, not a silent
 * pass.
 */
function parseHarnessClasses(): string[] {
  const src = harnessSource();
  const block = src.match(/export type StarterFailureClass\s*=([\s\S]+?);/);
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate `export type StarterFailureClass` union in " +
        "harness starter-smoke.ts — if the source shape changed, update this regex.",
    );
  }
  const classes = Array.from(block[1].matchAll(/"([a-z-]+)"/g)).map(
    (m) => m[1] as string,
  );
  if (classes.length === 0) {
    throw new Error(
      "drift parser: located the StarterFailureClass union but found no quoted " +
        "members — the source shape changed; update this regex.",
    );
  }
  return classes;
}

describe("starter errorClass contract drift (dashboard mirror vs harness)", () => {
  it("STARTER_FAILURE_CLASSES exactly matches the harness StarterFailureClass union (set-equal)", () => {
    const harness = new Set(parseHarnessClasses());
    const dashboard = new Set<string>(STARTER_FAILURE_CLASSES);
    // Set-equality both directions: a harness-only class (added upstream) and a
    // dashboard-only class (stale local copy) must BOTH red this test.
    expect([...dashboard].sort()).toEqual([...harness].sort());
  });

  it("the soft/hard split the tolerance relies on is present in the harness source", () => {
    const harness = new Set(parseHarnessClasses());
    // The two-miss tolerance hinges on these exact spellings — if any of them
    // is renamed upstream, the soft classifier in live-status.ts goes stale.
    expect(harness.has("transport-error")).toBe(true); // SOFT
    expect(harness.has("aborted")).toBe(true); // SOFT
    expect(harness.has("smoke-failed")).toBe(true); // HARD
  });
});
