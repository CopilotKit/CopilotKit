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
  // Destructure-with-fallback — assertion-free and matches the helper in
  // __tests__/cell-model.test.ts (and stays valid if
  // `noUncheckedIndexedAccess` is ever enabled).
  const [dimension = ""] = key.split(":");
  return {
    id: key,
    key,
    dimension,
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

  it("CF7-F3 #4: a FUTURE-dated observedAt beyond skew tolerance is treated as stale (cannot pin the overlay)", () => {
    // Clock skew / a corrupt producer timestamp: with observedAt ahead of
    // `now`, `now - parsed > staleAfterMs` is NEVER true, so the staleness
    // gate could never age the comm error out — the unreachable/pending
    // overlay would be pinned indefinitely. A timestamp more than the skew
    // tolerance (5min) in the future is as untrustworthy as an unparseable
    // one and must be skipped the same way.
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", SLUG, FEATURE),
      row(keyFor("e2e", SLUG, FEATURE), "green", {
        signal: commErrorSignal({
          kind: "worker-unreachable",
          // 1h ahead of NOW — far beyond any plausible clock skew.
          observedAt: "2026-06-04T13:00:00.000Z",
        }),
      }),
    );

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.commError).toBeUndefined();
    expect(model.surfaceState).not.toBe("unreachable");
  });

  it("CF7-F3 #4: a slightly-future observedAt WITHIN skew tolerance still surfaces (minor skew is normal)", () => {
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", SLUG, FEATURE),
      row(keyFor("e2e", SLUG, FEATURE), "green", {
        signal: commErrorSignal({
          kind: "worker-unreachable",
          // 1min ahead of NOW — ordinary producer/browser clock skew.
          observedAt: "2026-06-04T12:01:00.000Z",
        }),
      }),
    );

    const model = buildCellModel(live, WIRED, NOW);

    expect(model.commError?.kind).toBe("worker-unreachable");
    expect(model.surfaceState).toBe("unreachable");
  });
});

describe("buildCellModel — starter axis (probeAxis: 'starter')", () => {
  const COL = "google-adk";
  const STARTER_LEVELS = ["health", "agent", "chat", "interaction"] as const;
  const STARTER_CELL = {
    slug: COL,
    featureId: "starter",
    isSupported: true,
    isWired: true,
    probeAxis: "starter",
  } as const;

  function starterMap(
    states: Partial<Record<(typeof STARTER_LEVELS)[number], State>>,
    observedAt?: string,
  ): LiveStatusMap {
    const live: LiveStatusMap = new Map();
    for (const level of STARTER_LEVELS) {
      const st = states[level];
      if (st === undefined) continue;
      const key = keyFor("starter", COL, level);
      live.set(key, row(key, st, observedAt ? { observedAt } : {}));
    }
    return live;
  }

  it("derives GREEN when every starter level is fresh-green", () => {
    const live = starterMap({
      health: "green",
      agent: "green",
      chat: "green",
      interaction: "green",
    });
    const model = buildCellModel(live, STARTER_CELL, NOW);
    expect(model.chipColor).toBe("green");
    // It must NOT consult the agent ladder — d3/d4/d5/d6 are not the source.
    expect(model.supported).toBe(true);
  });

  it("derives RED when any starter level is red", () => {
    const live = starterMap({
      health: "green",
      agent: "green",
      chat: "green",
      interaction: "red",
    });
    const model = buildCellModel(live, STARTER_CELL, NOW);
    expect(model.chipColor).toBe("red");
  });

  it("derives GRAY when a starter level row is missing (unverified)", () => {
    const live = starterMap({
      health: "green",
      agent: "green",
      chat: "green",
      // interaction missing
    });
    const model = buildCellModel(live, STARTER_CELL, NOW);
    expect(model.chipColor).toBe("gray");
  });

  it("does NOT resolve a starter cell from agent e2e/d5/d6 rows", () => {
    // Only agent-axis rows present; no starter rows → starter cell is no-data.
    const live: LiveStatusMap = new Map();
    live.set(
      keyFor("e2e", COL, "agentic-chat"),
      row(keyFor("e2e", COL, "agentic-chat"), "green"),
    );
    const model = buildCellModel(live, STARTER_CELL, NOW);
    expect(model.chipColor).toBe("gray");
  });

  // A starter row past STARTER_STALE_AFTER_MS (2.5h). 3h before NOW is stale,
  // while the helper's default observed_at (30s before NOW) is fresh.
  const STALE_OBSERVED = "2026-06-04T09:00:00.000Z";

  it("derives AMBER (degraded fold) when all levels green but one is STALE", () => {
    // health/agent/chat fresh-green; interaction green but past the starter
    // staleness window → per-row stale-green→degraded fold → not-all-fresh →
    // amber. A SINGLE stale-green level can't be credited green, but it isn't a
    // red and the cell isn't wholly stale (3 fresh rows), so the matrix-stale
    // gray fold does NOT apply.
    const live: LiveStatusMap = new Map();
    for (const level of ["health", "agent", "chat"] as const) {
      const key = keyFor("starter", COL, level);
      live.set(key, row(key, "green"));
    }
    const staleKey = keyFor("starter", COL, "interaction");
    live.set(staleKey, row(staleKey, "green", { observedAt: STALE_OBSERVED }));

    const model = buildCellModel(live, STARTER_CELL, NOW);
    expect(model.chipColor).toBe("amber");
    // One fresh row keeps the cell off the matrix-stale gray fold.
    expect(model.isStaleCell).toBe(false);
  });

  it("derives GRAY with isStaleCell when ALL contributing rows are stale", () => {
    // Every level present and green but ALL past the matrix window → the U8
    // matrix-staleness fold collapses any colour to gray and flags the cell
    // stale ("re-sweep pending"). starterMap applies the one stale timestamp to
    // all four rows.
    const live = starterMap(
      {
        health: "green",
        agent: "green",
        chat: "green",
        interaction: "green",
      },
      STALE_OBSERVED,
    );
    const model = buildCellModel(live, STARTER_CELL, NOW);
    expect(model.chipColor).toBe("gray");
    expect(model.isStaleCell).toBe(true);
  });
});
