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

// The pure cell-classification fold cluster (cell-model / live-status) was
// relocated INTO the harness (`showcase/harness/src/shared/cell-model/`) so the
// dashboard AND the harness monitor import ONE copy; the dashboard's
// `./cell-model.ts` / `./live-status.ts` are now thin re-export barrels. This
// drift guard parses SOURCE TEXT, so it reads the canonical harness copies —
// the barrels carry no derivation body to match.
const SHARED_CELL_MODEL_DIR = resolve(
  __dirname,
  "../../../harness/src/shared/cell-model",
);
const DASHBOARD_CELL_MODEL_FILE = resolve(
  SHARED_CELL_MODEL_DIR,
  "./cell-model.ts",
);
const DASHBOARD_LIVE_STATUS_FILE = resolve(
  SHARED_CELL_MODEL_DIR,
  "./live-status.ts",
);

function harnessSource(): string {
  return readFileSync(HARNESS_CONTRACTS_FILE, "utf8");
}

function dashboardCellModelSource(): string {
  return readFileSync(DASHBOARD_CELL_MODEL_FILE, "utf8");
}

/**
 * Parse the string-literal members of the harness `POOL_COMM_ERROR_KINDS`
 * array. Throws if the block can't be located so a shape change is loud, not a
 * silent pass. Accepts an injectable `src` for the parser-robustness tests;
 * production callers read the real harness file.
 */
function parseHarnessKinds(src: string = harnessSource()): string[] {
  const block = src.match(
    /POOL_COMM_ERROR_KINDS\s*=\s*\[([\s\S]+?)\]\s*as const;/,
  );
  if (!block || !block[1]) {
    throw new Error(
      "drift parser: could not locate `POOL_COMM_ERROR_KINDS` array literal in " +
        "harness contracts.ts — if the source shape changed, update this regex.",
    );
  }
  // Strip comment lines BEFORE matching: the quoted-token pattern below is
  // NOT line-anchored, so a `//` or `/** … */` doc comment quoting a kind
  // (e.g. referencing a retired `"dead-kind"`) would otherwise parse as a
  // live member. Each remaining member is a double-quoted kind.
  const body = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const kinds = Array.from(
    body.matchAll(/"([a-z-]+)"/g),
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

/**
 * Extract the full `commErrorFromStatusSignal` function source from a file's
 * contents (used to pin the harness and dashboard copies byte-identical).
 * Throws if the function can't be located so a rename is loud.
 */
function parseCommErrorDecoder(src: string, file: string): string {
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
}

describe("drift parser robustness", () => {
  it("parseHarnessKinds ignores kinds quoted inside comments (line and block)", () => {
    // The quoted-token pattern is not line-anchored, so without the comment
    // strip a doc comment referencing a retired kind would parse as a live
    // member and silently widen the pinned kind set.
    const synthetic = [
      "export const POOL_COMM_ERROR_KINDS = [",
      '  // retired: "dead-line-kind" must not parse as a member',
      "  /**",
      '   * docs that mention "dead-block-kind" are not members either',
      "   */",
      '  "real-kind",',
      "] as const;",
    ].join("\n");
    expect(parseHarnessKinds(synthetic)).toEqual(["real-kind"]);
  });
});

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
    const dashboardSource = readFileSync(DASHBOARD_LIVE_STATUS_FILE, "utf8");
    expect(parseCommErrorDecoder(dashboardSource, "live-status.ts")).toBe(
      parseCommErrorDecoder(harnessSource(), "contracts.ts"),
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

  /**
   * Extract the dashboard's `surfaceState` derivation statement from
   * cell-model.ts. Match to the END OF THE STATEMENT (a `;` at end-of-line
   * followed by a blank line) — a bare non-greedy `;` would stop at a
   * semicolon inside the derivation's own comments. Throws if the statement
   * can't be located so a refactor is loud. Accepts an injectable `src` for
   * the parser-robustness test; production callers read the real file.
   */
  function parseDashboardSurfaceDerivation(
    src: string = dashboardCellModelSource(),
  ): string {
    const m = src.match(/const surfaceState: FleetSurfaceState =[\s\S]*?;\n\n/);
    if (!m) {
      throw new Error(
        "drift parser: could not locate the `surfaceState` derivation in " +
          "cell-model.ts — if the source shape changed, update this regex.",
      );
    }
    // STRUCTURAL END GUARD: the non-greedy `;\n\n` anchor stops at the FIRST
    // semicolon-before-blank-line, so an internal one would silently TRUNCATE
    // the parsed body and make the negative assertions over it vacuous. The
    // derivation's real end is the `chipColorToSurface(chipColor)` fallback —
    // reject any match that does not terminate there (a refactor that renames
    // the fallback must update this guard, loudly).
    if (!m[0].endsWith("chipColorToSurface(chipColor);\n\n")) {
      throw new Error(
        "drift parser: the `surfaceState` derivation parse was TRUNCATED — it " +
          "did not end at the `chipColorToSurface(chipColor)` terminal " +
          "fallback. An internal `;` + blank line shortened the match; " +
          "harden the anchor or update this guard.",
      );
    }
    return m[0];
  }

  it("the surface-derivation parser rejects a TRUNCATED parse (internal `;` + blank line)", () => {
    // The non-greedy `;\n\n` anchor stops at the FIRST semicolon followed by
    // a blank line. A future edit introducing one INSIDE the derivation would
    // silently shorten the parsed body — making the NEGATIVE assertions over
    // it (e.g. `not.toContain('chipColor === "green"')`) pass vacuously. The
    // parser must refuse any match that does not terminate at the
    // derivation's structural end (the chipColorToSurface fallback).
    const truncating = [
      "const surfaceState: FleetSurfaceState = commError",
      "  ? overlayFor(commError);",
      "",
      '  : chipColor === "green"',
      "    ? hiddenFromNegativeAssertions",
      "    : chipColorToSurface(chipColor);",
      "",
      "return surfaceState;",
    ].join("\n");
    expect(() => parseDashboardSurfaceDerivation(truncating)).toThrow(
      /truncated/i,
    );
  });

  it("dashboard cell-model derivation routes worker-reclaimed-pending → 'pending' with failure passthrough", () => {
    // Same pin on the dashboard side (behaviorally covered by the flap-band
    // #70 tests in __tests__/cell-model.test.ts; this guards the SHAPE so a
    // refactor that drops the reclaim branch reds the drift suite too).
    const body = parseDashboardSurfaceDerivation();
    expect(body).toContain('"worker-reclaimed-pending"');
    expect(body).toContain('"pending"');
    expect(body).toContain('"unreachable"');
    // The dashboard's pending gate must pass through EVERY failure colour in
    // its ChipColor vocabulary — red AND amber (degraded/partial failure) —
    // mirroring the harness only-green-becomes-pending semantics (G3a).
    expect(body).toContain('chipColor === "red"');
    expect(body).toContain('chipColor === "amber"');
  });

  it("the pending-gate ASYMMETRY is deliberate: harness green-only, dashboard green-or-gray (G3d)", () => {
    // The two derivations are NOT byte-mirrors and must not be: the harness
    // derives over `ProbeState`, which has NO no-data colour, so its pending
    // gate is GREEN-ONLY equality. The dashboard derives over `ChipColor`,
    // whose `gray` is a dashboard-only no-data colour the harness cannot
    // represent — there a reclaim on a no-data cell IS pending, so the gate
    // is expressed as FAILURE-PASSTHROUGH (red / amber / regression pass
    // through; green AND gray become "pending"). This test pins the
    // DERIVATION DIFFERENCE itself so neither side can silently "fix" the
    // asymmetry into a contradiction again.
    //
    // Harness side: green-equality gate, and no "gray" anywhere — the
    // ProbeState vocabulary cannot name the no-data case.
    const harnessBody = parseHarnessSurfaceDerivation();
    expect(harnessBody).toContain('row.state === "green"');
    expect(harnessBody).not.toContain('"gray"');
    //
    // Dashboard side: must NOT be a green-equality gate (that would drop the
    // gray→pending leg), and must consult the regression flag — a regressed
    // cell never reads as neutrally pending.
    const dashboardBody = parseDashboardSurfaceDerivation();
    expect(dashboardBody).not.toContain('chipColor === "green"');
    expect(dashboardBody).toContain("isRegression");
  });
});
