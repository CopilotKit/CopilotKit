/**
 * Cross-package contract drift test — the dashboard's hand-copied pool
 * COMM-ERROR contract vs the authoritative harness `contracts.ts`.
 *
 * WHY THIS EXISTS: the dashboard carries a STRUCTURAL COPY of the harness fleet
 * comm-error contract (`PoolCommError`, `POOL_COMM_ERROR_KINDS`,
 * `FLEET_COMM_ERROR_SIGNAL_KEY`, `commErrorFromStatusSignal`) in
 * `live-status.ts`, because it imports only `@/*` and never reaches across the
 * package boundary into harness source at runtime (same rule that makes
 * `STARTER_COLUMNS` a local copy of a harness producer constant). The harness
 * OWNS the producer side; the dashboard mirrors the read shape it consumes.
 * `live-status.ts` claims THIS test guards the two against drift — so it must
 * actually exist and actually compare them, or a future harness contract change
 * silently breaks the dashboard's "unreachable" overlay with no failing test.
 *
 * The harness lives in a SEPARATE pnpm workspace (`showcase/harness`), so the
 * dashboard cannot import across the package boundary. We parse the harness
 * source via `fs` (mirroring `starter-column-equality.test.ts`), reading the
 * authoritative `POOL_COMM_ERROR_KINDS` values + the signal key + the decode
 * shape directly so a rename / kind-add / key-change on the harness side reds
 * this test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  POOL_COMM_ERROR_KINDS,
  FLEET_COMM_ERROR_SIGNAL_KEY,
  commErrorFromStatusSignal,
} from "./live-status";

const HARNESS_CONTRACTS_FILE = resolve(
  __dirname,
  "../../../harness/src/fleet/contracts.ts",
);

function harnessSource(): string {
  return readFileSync(HARNESS_CONTRACTS_FILE, "utf8");
}

/**
 * Parse the string-literal members of the harness `POOL_COMM_ERROR_KINDS`
 * array. Throws if the block can't be located so a shape change is loud, not a
 * silent pass.
 */
function parseHarnessKinds(): string[] {
  const src = harnessSource();
  const block = src.match(
    /POOL_COMM_ERROR_KINDS\s*=\s*\[([\s\S]+?)\]\s*as const;/,
  );
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate `POOL_COMM_ERROR_KINDS` array literal in " +
        "harness contracts.ts — if the source shape changed, update this regex.",
    );
  }
  // Each member is a double-quoted kind on its own line (comment lines skipped
  // because they have no quoted token matched by this pattern at line position).
  const kinds = Array.from(
    block[1].matchAll(/"([a-z-]+)"/g),
    (m) => m[1] as string,
  );
  if (kinds.length === 0) {
    throw new Error(
      "drift parser: parsed zero kinds from POOL_COMM_ERROR_KINDS — regex " +
        "likely drifted from the source shape.",
    );
  }
  return kinds;
}

/**
 * Parse the harness `FLEET_COMM_ERROR_SIGNAL_KEY` string literal value.
 */
function parseHarnessSignalKey(): string {
  const src = harnessSource();
  const m = src.match(
    /FLEET_COMM_ERROR_SIGNAL_KEY\s*=\s*"([^"]+)"\s*as const;/,
  );
  if (!m || !m[1]) {
    throw new Error(
      "drift parser: could not locate `FLEET_COMM_ERROR_SIGNAL_KEY` literal in " +
        "harness contracts.ts — if the source shape changed, update this regex.",
    );
  }
  return m[1];
}

describe("pool comm-error contract cross-package drift", () => {
  it("dashboard POOL_COMM_ERROR_KINDS exactly equals the harness kind set", () => {
    const harnessKinds = new Set(parseHarnessKinds());
    const dashboardKinds = new Set<string>(POOL_COMM_ERROR_KINDS);

    for (const kind of harnessKinds) {
      expect(
        dashboardKinds.has(kind),
        `harness declares comm-error kind "${kind}" but the dashboard ` +
          `POOL_COMM_ERROR_KINDS has no entry — a worker emitting it would ` +
          `decode to undefined and render as a normal probe colour, not "unreachable"`,
      ).toBe(true);
    }
    for (const kind of dashboardKinds) {
      expect(
        harnessKinds.has(kind),
        `dashboard POOL_COMM_ERROR_KINDS has "${kind}" but the harness contract ` +
          `does not declare it — the harness can never produce that kind`,
      ).toBe(true);
    }
    expect(dashboardKinds.size).toBe(harnessKinds.size);
  });

  it("dashboard FLEET_COMM_ERROR_SIGNAL_KEY exactly equals the harness key", () => {
    // If these drift, the dashboard reads the comm error out of the WRONG
    // signal-blob key and the "unreachable" overlay silently never renders.
    expect(FLEET_COMM_ERROR_SIGNAL_KEY).toBe(parseHarnessSignalKey());
  });

  it("dashboard decode behavior matches the harness contract on a well-formed signal", () => {
    // Build a signal exactly as the harness writer does (commErrorToStatusSignal
    // nests the error under FLEET_COMM_ERROR_SIGNAL_KEY) using the parsed harness
    // key, then assert the dashboard reader recovers it. This pins the DECODE
    // contract, not just the constant values: a future change to the nesting /
    // required fields on either side reds this test.
    const harnessKey = parseHarnessSignalKey();
    const err = {
      kind: parseHarnessKinds()[0],
      message: "connect ECONNREFUSED 10.0.0.5:8080",
      workerId: "worker-7",
      jobId: "job-42",
      observedAt: "2026-06-04T12:00:00.000Z",
    };
    const signal = { [harnessKey]: err };
    expect(commErrorFromStatusSignal(signal)).toEqual(err);
  });

  it("dashboard decode rejects an unknown kind (fail-safe to normal colour)", () => {
    // A kind the harness never declares must decode to undefined so the cell
    // renders its normal probe colour rather than a half-populated overlay.
    const harnessKey = parseHarnessSignalKey();
    const signal = {
      [harnessKey]: {
        kind: "not-a-real-harness-kind",
        message: "x",
        observedAt: "2026-06-04T12:00:00.000Z",
      },
    };
    expect(commErrorFromStatusSignal(signal)).toBeUndefined();
  });
});
