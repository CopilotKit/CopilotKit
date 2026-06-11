/**
 * cell-model — comm-error overlay precedence (flap-band FF3/FF4/FF5/FF7).
 *
 * These cases pin the load-bearing invariant: a NEUTRAL
 * `worker-reclaimed-pending` overlay must never mask a GENUINE red, and a
 * newer reclaim must never out-rank an older directly-observed crash. They
 * also pin the staleness fail-safe for an unparseable `observedAt`.
 */
import { describe, it, expect } from "vitest";
import { buildCellModel } from "./cell-model";
import { keyFor, FLEET_COMM_ERROR_SIGNAL_KEY } from "./live-status";
import type {
  LiveStatusMap,
  StatusRow,
  State,
  PoolCommError,
} from "./live-status";

const SLUG = "acme";
const FEATURE = "beautiful-chat";
const NOW = Date.parse("2026-06-04T12:00:00.000Z");

function commErrorSignal(err: Partial<PoolCommError>): Record<string, unknown> {
  return {
    [FLEET_COMM_ERROR_SIGNAL_KEY]: {
      kind: "worker-unreachable",
      message: "x",
      observedAt: "2026-06-04T11:59:00.000Z",
      ...err,
    },
  };
}

function row(
  key: string,
  state: State,
  opts: { signal?: unknown; observedAt?: string } = {},
): StatusRow {
  const observed = opts.observedAt ?? "2026-06-04T11:59:30.000Z";
  return {
    id: key,
    key,
    dimension: key.split(":")[0],
    state,
    signal: opts.signal ?? null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? observed : null,
  };
}

const WIRED = {
  slug: SLUG,
  featureId: FEATURE,
  isSupported: true,
  isWired: true,
} as const;

describe("buildCellModel — comm-error overlay precedence", () => {
  it("FF4: a present red is NOT masked by a reclaimed-pending overlay", () => {
    // A red e2e (D3) row → chipColor red, AND it carries a reclaimed-pending
    // comm-error overlay. The neutral "pending" surface must NOT hide the red.
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", SLUG, FEATURE),
      row(keyFor("e2e", SLUG, FEATURE), "red", {
        signal: commErrorSignal({
          kind: "worker-reclaimed-pending",
          observedAt: "2026-06-04T11:59:50.000Z",
        }),
      }),
    );

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.chipColor).toBe("red");
    expect(model.commError?.kind).toBe("worker-reclaimed-pending");
    // Pre-fix this resolved to "pending"; the genuine red must win.
    expect(model.surfaceState).toBe("red");
  });

  it("routine teardown (non-red probe) still shows the neutral pending surface", () => {
    // A green e2e row carrying a reclaimed-pending overlay → no red, no
    // regression → the neutral gray "pending" surface is correct.
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", SLUG, FEATURE),
      row(keyFor("e2e", SLUG, FEATURE), "green", {
        signal: commErrorSignal({
          kind: "worker-reclaimed-pending",
          observedAt: "2026-06-04T11:59:50.000Z",
        }),
      }),
    );

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.chipColor).not.toBe("red");
    expect(model.surfaceState).toBe("pending");
  });

  it("FF5: an older real crash out-ranks a newer reclaimed-pending", () => {
    // The e2e row carries an OLDER directly-observed crash; the d6 aggregate
    // carries a NEWER reclaim. The crash must win (severity over recency).
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", SLUG, FEATURE),
      row(keyFor("e2e", SLUG, FEATURE), "green", {
        signal: commErrorSignal({
          kind: "worker-crashed-mid-job",
          observedAt: "2026-06-04T11:58:00.000Z",
        }),
      }),
    );
    live.set(
      keyFor("d6", SLUG),
      row(keyFor("d6", SLUG), "green", {
        signal: commErrorSignal({
          kind: "worker-reclaimed-pending",
          observedAt: "2026-06-04T11:59:50.000Z",
        }),
      }),
    );

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.commError?.kind).toBe("worker-crashed-mid-job");
    expect(model.surfaceState).toBe("unreachable");
  });

  it("G2f: a green tools row with the chat row MISSING does not credit D4 (chat is unconditionally expected)", () => {
    // The D4 producer ALWAYS writes `chat:<slug>` (the L3 round-trip) and
    // writes `tools:<slug>` only for integrations whose demos include
    // tool-rendering. A tools-only fold therefore means the unconditional
    // chat row is missing — an unverified family that must NOT be credited
    // green (mirrors the D5/D6 missing-mapped-sub-row collapse).
    const live: LiveStatusMap = new Map();
    live.set(keyFor("tools", SLUG), row(keyFor("tools", SLUG), "green"));

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.d4?.exists).toBe(true);
    expect(model.d4?.status).toBeNull();
    expect(model.d4?.row).toBeNull();
  });

  it("G2f: a RED tools row still surfaces even when the chat row is missing (red dominates no-data)", () => {
    const live: LiveStatusMap = new Map();
    live.set(keyFor("tools", SLUG), row(keyFor("tools", SLUG), "red"));

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.d4?.status).toBe("red");
    expect(model.d4?.row?.key).toBe(keyFor("tools", SLUG));
  });

  it("G2f: a green chat row with tools missing keeps crediting D4 (tools is producer-conditional)", () => {
    // tools:<slug> legitimately doesn't exist for integrations without the
    // tool-rendering demo, and the dashboard has no per-integration demo
    // mapping to distinguish "not expected" from "not yet emitted" — so a
    // missing tools row stays lenient (documented on resolveD4).
    const live: LiveStatusMap = new Map();
    live.set(keyFor("chat", SLUG), row(keyFor("chat", SLUG), "green"));

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.d4?.status).toBe("green");
  });

  it("FF7: an unparseable observedAt is treated as stale (no phantom overlay)", () => {
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", SLUG, FEATURE),
      row(keyFor("e2e", SLUG, FEATURE), "green", {
        signal: commErrorSignal({
          kind: "worker-unreachable",
          observedAt: "not-a-real-timestamp",
        }),
      }),
    );

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.commError).toBeUndefined();
    expect(model.surfaceState).not.toBe("unreachable");
  });
});
