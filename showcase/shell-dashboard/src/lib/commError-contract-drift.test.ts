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
import type { FleetSurfaceState } from "./live-status";

const HARNESS_CONTRACTS_FILE = resolve(
  __dirname,
  "../../../harness/src/fleet/contracts.ts",
);

const DASHBOARD_CELL_MODEL_FILE = resolve(__dirname, "./cell-model.ts");

function harnessSource(): string {
  return readFileSync(HARNESS_CONTRACTS_FILE, "utf8");
}

function dashboardCellModelSource(): string {
  return readFileSync(DASHBOARD_CELL_MODEL_FILE, "utf8");
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

/**
 * Parse the string-literal members of the harness `FleetSurfaceState` union
 * (the members BEYOND the base `ProbeState` colours). Throws if the union
 * can't be located so a shape change is loud, not a silent pass.
 */
function parseHarnessSurfaceOverlayMembers(): string[] {
  const src = harnessSource();
  const m = src.match(/export type FleetSurfaceState\s*=\s*([^;]+);/);
  if (!m || !m[1]) {
    throw new Error(
      "drift parser: could not locate the `FleetSurfaceState` union in " +
        "harness contracts.ts — if the source shape changed, update this regex.",
    );
  }
  const members = Array.from(
    m[1].matchAll(/"([a-z-]+)"/g),
    (mm) => mm[1] as string,
  );
  if (members.length === 0) {
    throw new Error(
      "drift parser: parsed zero literal members from the harness " +
        "FleetSurfaceState union — regex likely drifted from the source shape.",
    );
  }
  return members;
}

/**
 * Parse the body of the harness `fleetSurfaceState` derivation function.
 * Throws if the function can't be located so a rename is loud.
 */
function parseHarnessSurfaceDerivation(): string {
  const src = harnessSource();
  const m = src.match(/export function fleetSurfaceState\([\s\S]*?\n\}/);
  if (!m) {
    throw new Error(
      "drift parser: could not locate `fleetSurfaceState` in harness " +
        "contracts.ts — if the source shape changed, update this regex.",
    );
  }
  return m[0];
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

  it("dashboard decode rejects an ARRAY embedded under the signal key", () => {
    // Arrays are `typeof "object"`: an array carrying comm-error fields as
    // EXPANDO properties would pass a bare typeof check and decode as if it
    // were a well-formed PoolCommError. An array is never a valid wire shape,
    // so the decoder must reject it explicitly (mirrors the harness copy —
    // see the byte-identity pin below).
    const harnessKey = parseHarnessSignalKey();
    expect(commErrorFromStatusSignal({ [harnessKey]: [] })).toBeUndefined();
    expect(
      commErrorFromStatusSignal({
        [harnessKey]: Object.assign([], {
          kind: parseHarnessKinds()[0],
          message: "x",
          observedAt: "2026-06-04T12:00:00.000Z",
        }),
      }),
    ).toBeUndefined();
  });

  it("commErrorFromStatusSignal is byte-identical between harness and dashboard", () => {
    // The two copies must never diverge: the dashboard's reader is a
    // structural mirror of the harness reader, and a fix landing on one side
    // only (e.g. the Array.isArray rejection) silently re-opens the gap on
    // the other. Pin the FULL function source byte-for-byte.
    const extract = (src: string, file: string): string => {
      const m = src.match(
        /export function commErrorFromStatusSignal\([\s\S]*?\n\}/,
      );
      if (!m) {
        throw new Error(
          `drift parser: could not locate commErrorFromStatusSignal in ${file} ` +
            "— if the source shape changed, update this regex.",
        );
      }
      return m[0];
    };
    const dashboardSource = readFileSync(
      resolve(__dirname, "./live-status.ts"),
      "utf8",
    );
    expect(extract(dashboardSource, "live-status.ts")).toBe(
      extract(harnessSource(), "contracts.ts"),
    );
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

describe("fleet surface-state contract cross-package drift", () => {
  // The two `FleetSurfaceState` unions are expressed over DIFFERENT base
  // colour vocabularies (the harness over `ProbeState`, the dashboard over
  // `ChipColor` — see the live-status.ts union comment), so the pinned shared
  // surface is the set of PRESENTATION OVERLAY members both sides must carry:
  // the red "unreachable" crash overlay and the neutral gray "pending"
  // re-queued surface. The `satisfies` clause makes this list a COMPILE-TIME
  // pin of the dashboard union — dropping either member from the dashboard
  // `FleetSurfaceState` reds the typecheck, not just this test.
  const OVERLAY_MEMBERS = [
    "unreachable",
    "pending",
  ] as const satisfies readonly FleetSurfaceState[];

  it("harness FleetSurfaceState union carries exactly the overlay members the dashboard union does", () => {
    // If the harness union gains/loses an overlay member the dashboard never
    // renders (or vice versa), the two packages disagree about what a fleet
    // surface can BE — the drift this file exists to catch.
    expect(new Set(parseHarnessSurfaceOverlayMembers())).toEqual(
      new Set<string>(OVERLAY_MEMBERS),
    );
  });

  it("harness fleetSurfaceState derivation routes worker-reclaimed-pending → 'pending' ONLY on green (failure passthrough)", () => {
    // Pins the harness DERIVATION shape: the sweep-inferred reclaim kind must
    // route to the neutral "pending" surface (never the red "unreachable"
    // overlay) ONLY when the row's last-known colour is green — ANY non-green
    // failure state (red, degraded, error, out-of-vocab) must pass through
    // unmasked. The same only-healthy-becomes-pending derivation cell-model.ts
    // applies on the dashboard side over its ChipColor vocabulary.
    const body = parseHarnessSurfaceDerivation();
    expect(body).toContain('"worker-reclaimed-pending"');
    expect(body).toContain('"pending"');
    expect(body).toContain('"unreachable"');
    // The pending gate must be expressed as only-green-becomes-pending —
    // a literal red-equality check (`=== "red"`) masks degraded/error/
    // out-of-vocab failure states behind the neutral overlay (G3a).
    expect(body).toContain('=== "green"');
    expect(body).not.toContain('=== "red"');
  });

  it("dashboard cell-model derivation routes worker-reclaimed-pending → 'pending' with failure passthrough", () => {
    // Same pin on the dashboard side (behaviorally covered by the flap-band
    // #70 tests in __tests__/cell-model.test.ts; this guards the SHAPE so a
    // refactor that drops the reclaim branch reds the drift suite too).
    // Match to the END OF THE STATEMENT (a `;` at end-of-line followed by a
    // blank line) — a bare non-greedy `;` would stop at a semicolon inside the
    // derivation's own comments.
    const m = dashboardCellModelSource().match(
      /const surfaceState: FleetSurfaceState =[\s\S]*?;\n\n/,
    );
    if (!m) {
      throw new Error(
        "drift parser: could not locate the `surfaceState` derivation in " +
          "cell-model.ts — if the source shape changed, update this regex.",
      );
    }
    const body = m[0];
    expect(body).toContain('"worker-reclaimed-pending"');
    expect(body).toContain('"pending"');
    expect(body).toContain('"unreachable"');
    // The dashboard's pending gate must pass through EVERY failure colour in
    // its ChipColor vocabulary — red AND amber (degraded/partial failure) —
    // mirroring the harness only-green-becomes-pending semantics (G3a).
    expect(body).toContain('chipColor === "red"');
    expect(body).toContain('chipColor === "amber"');
  });
});
