import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CATALOG_TO_D5_KEY,
  FLEET_COMM_ERROR_SIGNAL_KEY,
  STARTER_COLUMNS,
  STARTER_LEVELS,
  STATUS_LIST_FIELDS,
  buildStarterBadge,
  commErrorFromStatusSignal,
  keyFor,
  mergeRowsToMap,
  resolveCell,
  resolveD4Row,
  resolveD5Row,
  resolveD6Row,
  resolveStarterRow,
  starterIsSupported,
  statusSignalHasCommErrorKey,
  upsertByKey,
} from "./live-status";
import type { LiveStatusMap, StatusRow, StarterLevel } from "./live-status";
import { formatTs } from "./format-ts";
import {
  D4_STALE_AFTER_MS,
  E2E_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
  STARTER_STALE_AFTER_MS,
} from "./staleness";

// A recent timestamp so green rows are not treated as stale by the
// staleness downgrade in resolveCell (which compares against Date.now()).
// Mirrors the FRESH_OBSERVED_AT pattern in compute-tally-detail.test.tsx.
const FRESH_OBSERVED_AT = new Date().toISOString();

function row(
  key: string,
  dimension: string,
  state: StatusRow["state"],
  overrides: Partial<StatusRow> = {},
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: FRESH_OBSERVED_AT,
    transitioned_at: FRESH_OBSERVED_AT,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? FRESH_OBSERVED_AT : null,
    ...overrides,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

describe("statusSignalHasCommErrorKey (sibling of the harness contract companion)", () => {
  it("distinguishes 'key present but undecodable' from 'genuinely absent' without changing the decode contract", () => {
    // Key present, kind unknown to this reader (the version-skew case): the
    // decode fail-safes to undefined but the companion still sees the key.
    const unknownKind = {
      [FLEET_COMM_ERROR_SIGNAL_KEY]: {
        kind: "some-future-kind",
        message: "x",
        observedAt: FRESH_OBSERVED_AT,
      },
    };
    expect(commErrorFromStatusSignal(unknownKind)).toBeUndefined();
    expect(statusSignalHasCommErrorKey(unknownKind)).toBe(true);

    // Key present and well-formed: both sides agree.
    const wellFormed = {
      [FLEET_COMM_ERROR_SIGNAL_KEY]: {
        kind: "worker-unreachable",
        message: "connect ECONNREFUSED",
        observedAt: FRESH_OBSERVED_AT,
      },
    };
    expect(commErrorFromStatusSignal(wellFormed)).toBeDefined();
    expect(statusSignalHasCommErrorKey(wellFormed)).toBe(true);

    // Genuinely absent / never a valid wire shape (mirrors the decoder's
    // null / non-object / array guards — including the key as an array
    // expando property).
    expect(statusSignalHasCommErrorKey({ failedCount: 0 })).toBe(false);
    expect(statusSignalHasCommErrorKey(null)).toBe(false);
    expect(statusSignalHasCommErrorKey("nope")).toBe(false);
    expect(
      statusSignalHasCommErrorKey(
        Object.assign([], { [FLEET_COMM_ERROR_SIGNAL_KEY]: {} }),
      ),
    ).toBe(false);
  });
});

describe("keyFor", () => {
  it("integration-level dimensions have no feature segment", () => {
    expect(keyFor("health", "agno")).toBe("health:agno");
  });
  it("per-feature dimensions append /<featureId>", () => {
    expect(keyFor("smoke", "agno", "agentic-chat")).toBe(
      "smoke:agno/agentic-chat",
    );
    expect(keyFor("e2e", "agno", "agentic-chat")).toBe("e2e:agno/agentic-chat");
  });
  it("d5 uses per-feature key shape", () => {
    // Driver `e2e-deep` emits per-feature rows under these keys —
    // the dashboard MUST match the producer shape.
    expect(keyFor("d5", "agno", "agentic-chat")).toBe("d5:agno/agentic-chat");
  });
  it("d6 uses the per-cell key shape production reads", () => {
    // Driver `e2e-parity` emits one `d6:<slug>/<featureType>` row per cell
    // (the same featureType keyspace D5 uses, mapped via CATALOG_TO_D5_KEY),
    // and the dashboard resolves D6 PER-CELL against that key — see
    // resolveD6Row. This is the shape per-cell rendering actually looks up.
    expect(keyFor("d6", "agno", "tool-rendering")).toBe(
      "d6:agno/tool-rendering",
    );
  });
  it("d6 aggregate key shape still exists but is NOT what per-cell rendering reads", () => {
    // keyFor CAN still produce the bare `d6:<slug>` aggregate key, and the
    // `e2e-parity` driver still emits a single aggregate row that is red
    // whenever ANY cell fails. But resolveD6Row never reads it — per-cell
    // badges resolve the mapped `d6:<slug>/<featureType>` row instead.
    expect(keyFor("d6", "agno")).toBe("d6:agno");
  });
  it("throws when slug contains ':' (lookup-map collision guard)", () => {
    expect(() => keyFor("smoke", "bad:slug")).toThrow(/must not contain/);
  });
  it("throws when slug contains '/' (lookup-map collision guard)", () => {
    expect(() => keyFor("smoke", "bad/slug")).toThrow(/must not contain/);
  });
  it("throws when featureId contains ':' or '/'", () => {
    expect(() => keyFor("e2e", "agno", "bad:id")).toThrow(/must not contain/);
    expect(() => keyFor("e2e", "agno", "bad/id")).toThrow(/must not contain/);
  });
  it("throws when dimension contains ':' or '/' (G3e — same guard as the other segments)", () => {
    // `:` is the dimension/slug delimiter; a colon-bearing dimension would
    // silently parse as a DIFFERENT dimension + slug suffix, and a
    // slash-bearing one would fabricate a phantom feature segment.
    expect(() => keyFor("bad:dim", "agno")).toThrow(/must not contain/);
    expect(() => keyFor("bad/dim", "agno")).toThrow(/must not contain/);
  });
  it("throws on an empty-string featureId instead of fabricating the aggregate key", () => {
    // An empty featureId is falsy, so a truthiness guard would skip the
    // delimiter validation AND the per-feature branch, silently producing the
    // integration-aggregate key (`e2e:agno`) for what the caller meant as a
    // per-feature lookup. Throw loudly, matching the guard's defensive posture.
    expect(() => keyFor("e2e", "agno", "")).toThrow(/empty/);
  });
  it("every CATALOG_TO_D5_KEY mapping value is delimiter-free (keyFor feeds these as featureId)", () => {
    // resolveD5Row/resolveD6Row pass each mapping value into keyFor as the
    // featureId segment. keyFor's guard protects slug + the caller-supplied
    // featureId, but NOT the mapping values themselves — a ':' or '/' smuggled
    // into a mapping value would produce an ambiguous/colliding key. Assert the
    // table is clean so the guard's coverage is complete.
    for (const [feature, d5Keys] of Object.entries(CATALOG_TO_D5_KEY)) {
      for (const d5Key of d5Keys) {
        expect(
          d5Key.includes(":") || d5Key.includes("/"),
          `CATALOG_TO_D5_KEY["${feature}"] value "${d5Key}" must not contain ':' or '/'`,
        ).toBe(false);
      }
    }
  });
});

describe("upsertByKey", () => {
  it("appends when key is absent", () => {
    const a = row("k:1", "smoke", "green");
    const out = upsertByKey([], a);
    expect(out).toHaveLength(1);
  });
  it("replaces when key is present", () => {
    const a = row("k:1", "smoke", "green");
    const b = row("k:1", "smoke", "red");
    const out = upsertByKey([a], b);
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe("red");
  });
  it("returns the same array reference for a no-op update (React short-circuit)", () => {
    // Producer re-emits the same row at every poll tick when nothing
    // changed; reducing through upsertByKey must NOT allocate a new
    // array or React will re-render every memoised consumer downstream.
    const a = row("k:noop", "smoke", "green");
    const aPrime = row("k:noop", "smoke", "green");
    const before = [a];
    const after = upsertByKey(before, aPrime);
    expect(after).toBe(before);
  });
  it("allocates a new array when state changes", () => {
    const a = row("k:1", "smoke", "green");
    const b = row("k:1", "smoke", "degraded");
    const before = [a];
    const after = upsertByKey(before, b);
    expect(after).not.toBe(before);
    expect(after[0]!.state).toBe("degraded");
  });
  it("allocates a new array when observed_at changes (heartbeat-with-update)", () => {
    const a = row("k:1", "smoke", "green");
    const b = row("k:1", "smoke", "green", {
      observed_at: "2026-04-21T00:00:00Z",
    });
    const before = [a];
    const after = upsertByKey(before, b);
    expect(after).not.toBe(before);
    expect(after[0]!.observed_at).toBe("2026-04-21T00:00:00Z");
  });
  it("allocates a new array when only fail_count changes (not a no-op)", () => {
    // A red row's fail_count increments on every consecutive failure while
    // observed_at/transitioned_at can stay put within a tick; the drilldown
    // and alerting surfaces read it, so the delta must NOT be swallowed.
    const a = row("k:fc", "smoke", "red", { fail_count: 1 });
    const b = row("k:fc", "smoke", "red", { fail_count: 2 });
    const before = [a];
    const after = upsertByKey(before, b);
    expect(after).not.toBe(before);
    expect(after[0]!.fail_count).toBe(2);
  });
  it("allocates a new array when only first_failure_at changes (load-bearing in tooltips)", () => {
    // formatTooltip renders "red since <first_failure_at>" — a delta that
    // moves only this field is observable copy and must not be discarded.
    const a = row("k:ffa", "smoke", "red", {
      first_failure_at: "2026-06-01T00:00:00.000Z",
    });
    const b = row("k:ffa", "smoke", "red", {
      first_failure_at: "2026-06-02T00:00:00.000Z",
    });
    const before = [a];
    const after = upsertByKey(before, b);
    expect(after).not.toBe(before);
    expect(after[0]!.first_failure_at).toBe("2026-06-02T00:00:00.000Z");
  });
  it("allocates a new array when only id changes (deleted-and-recreated PB row)", () => {
    // A status row deleted and recreated upstream keeps its key but gets a
    // fresh PB id; keeping the stale id in the map breaks any id-keyed
    // follow-up fetch (e.g. the drilldown's full-row load).
    const a = row("k:id", "smoke", "green", { id: "rec-old" });
    const b = row("k:id", "smoke", "green", { id: "rec-new" });
    const before = [a];
    const after = upsertByKey(before, b);
    expect(after).not.toBe(before);
    expect(after[0]!.id).toBe("rec-new");
  });
  it("applies a row whose signal goes from absent to present (SSE full-row delivery)", () => {
    // The initial fetch projection drops `signal`, so initial rows arrive with
    // `signal === undefined` and rely on SSE deltas to deliver the populated
    // signal. A delta re-delivering the same key/state/observed_at/transitioned_at
    // but now CARRYING a signal must NOT be treated as a no-op — otherwise the
    // signal-less row survives and the "SSE delivers full rows" contract that
    // cell-pieces.tsx / cell-drilldown.tsx rely on is broken.
    const prev = row("k:sig", "smoke", "red", { signal: undefined });
    const next = row("k:sig", "smoke", "red", {
      signal: { error: "boom" },
    });
    const before = [prev];
    const after = upsertByKey(before, next);
    expect(after).not.toBe(before);
    expect(after[0]!.signal).toEqual({ error: "boom" });
  });
  it("no-ops when signal presence is unchanged (optimization preserved)", () => {
    // A genuinely-identical delta — same key/state/observed_at/transitioned_at
    // AND same signal presence — must still short-circuit to the same array
    // reference so memoised consumers don't needlessly re-render.
    const a = row("k:samesig", "smoke", "red", { signal: { error: "x" } });
    const aPrime = row("k:samesig", "smoke", "red", {
      signal: { error: "y" },
    });
    const before = [a];
    const after = upsertByKey(before, aPrime);
    expect(after).toBe(before);
  });
});

describe("mergeRowsToMap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges disjoint key sets without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = mergeRowsToMap(
      [row("health:a", "health", "green")],
      [row("e2e:a/b", "e2e", "red")],
    );
    expect(map.size).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });
  it("does NOT warn on identical-content rows with different references (no false collision)", () => {
    // The same producer row re-allocated across two groups (different object
    // reference, identical key/state/observed_at/transitioned_at) is NOT a
    // genuine invariant violation. Pre-fix the reference-based `prior !== r`
    // check fired a noisy false warning here.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = row("dup:k", "smoke", "green");
    const aClone = row("dup:k", "smoke", "green"); // distinct object, same content
    expect(a).not.toBe(aClone);
    const map = mergeRowsToMap([a], [aClone]);
    expect(map.get("dup:k")?.state).toBe("green");
    expect(warn).not.toHaveBeenCalled();
  });
  it("warns on collision but still applies last-wins (disjoint-key invariant guard)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = row("dup:k", "smoke", "green");
    const second = row("dup:k", "smoke", "red");
    const map = mergeRowsToMap([first], [second]);
    expect(map.get("dup:k")?.state).toBe("red");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/disjoint-key invariant violated/);
  });
  it("does NOT warn when rows differ ONLY by signal presence (projection vs SSE provenance, CF7-F3 #5)", () => {
    // The initial bulk fetch projects `signal` away while SSE deltas (and the
    // comm-error supplemental fetch) deliver full rows, so the SAME logical
    // row can legitimately exist in two groups with and without `signal`.
    // That presence flip is expected provenance, not a disjoint-key invariant
    // violation — warning on it is pure noise. (upsertByKey's reducer keeps
    // treating the flip as observable; only THIS divergence warn excludes it.)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const projected = row("d6:agno", "d6", "green", { signal: undefined });
    const full = row("d6:agno", "d6", "green", { signal: { detail: "x" } });
    const map = mergeRowsToMap([projected], [full]);
    // Last-wins still applies — the signal-bearing row survives.
    expect(map.get("d6:agno")?.signal).toEqual({ detail: "x" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveD6Row / resolveD5Row — out-of-vocabulary state tolerance (Fix A2)", () => {
  // The dashboard State union is green|red|degraded, but the harness CAN persist
  // a row with state:"error" (the no-data representation; see
  // result-aggregator.ts). STATE_RANK/WORST_STATE_RANK are Record<State,number>,
  // so STATE_RANK["error"] is undefined and the fold comparison `undefined > n`
  // is false — an "error" row is SILENTLY DROPPED instead of surfacing. The fold
  // must treat an unknown/out-of-vocabulary state as the WORST (most severe) so
  // such a row surfaces rather than vanishing.
  const OUT_OF_VOCAB = "error" as unknown as StatusRow["state"];

  it("does NOT silently drop a lone d6 row carrying an out-of-vocabulary state", () => {
    // `agentic-chat` maps to a single d6 key, so the fold sees exactly one row.
    const live = mapOf([row("d6:agno/agentic-chat", "d6", OUT_OF_VOCAB)]);
    const c = resolveCell(live, "agno", "agentic-chat");
    // Pre-fix: the "error" row is dropped, resolveD6Row returns null → d6.row is
    // null. Post-fix: the row surfaces as the worst-state winner.
    expect(c.d6.row).not.toBeNull();
    expect(c.d6.row?.state).toBe(OUT_OF_VOCAB);
  });

  it("surfaces an out-of-vocabulary d6 row as WORST over a present green sibling", () => {
    // `beautiful-chat` maps to multiple d6 keys; an out-of-vocab row must win the
    // fold over a present green sibling (treated as most severe, not skipped).
    const live = mapOf([
      row("d6:agno/beautiful-chat-toggle-theme", "d6", "green"),
      row("d6:agno/beautiful-chat-pie-chart", "d6", OUT_OF_VOCAB),
      row("d6:agno/beautiful-chat-bar-chart", "d6", "green"),
      row("d6:agno/beautiful-chat-search-flights", "d6", "green"),
      row("d6:agno/beautiful-chat-schedule-meeting", "d6", "green"),
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d6.row?.state).toBe(OUT_OF_VOCAB);
  });

  it("does NOT silently drop a lone d5 row carrying an out-of-vocabulary state", () => {
    const live = mapOf([row("d5:agno/agentic-chat", "d5", OUT_OF_VOCAB)]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d5.row).not.toBeNull();
    expect(c.d5.row?.state).toBe(OUT_OF_VOCAB);
  });

  it("d6: missing sub-row + out-of-vocab sub-row SURFACES, not collapses to no-data", () => {
    // The anyMissing collapse must be RANK-based, not `worstState !== "red"`
    // literal equality: an out-of-vocabulary "error" sub-row is ranked ABOVE
    // red by the A2 machinery ("never silently swallowed"), so a family with
    // a missing sibling must still surface it — collapsing to null would
    // swallow exactly the state the rank fold exists to surface.
    const live = mapOf([
      row("d6:agno/beautiful-chat-pie-chart", "d6", OUT_OF_VOCAB),
      row("d6:agno/beautiful-chat-toggle-theme", "d6", "green"),
      // the other 3 beautiful-chat sub-rows are MISSING
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d6.row).not.toBeNull();
    expect(c.d6.row?.state).toBe(OUT_OF_VOCAB);
  });

  it("d5: missing sub-row + out-of-vocab sub-row SURFACES, not collapses to no-data", () => {
    const live = mapOf([
      row("d5:agno/beautiful-chat-pie-chart", "d5", OUT_OF_VOCAB),
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green"),
      // the other 3 beautiful-chat sub-rows are MISSING
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d5.row).not.toBeNull();
    expect(c.d5.row?.state).toBe(OUT_OF_VOCAB);
  });
});

describe("resolveD4Row — worst-state fold mirroring cell-model resolveD4", () => {
  // Fixed `now` so the stale/fresh boundary is deterministic (same
  // convention as the staleness-downgrade suite below).
  const NOW = Date.parse("2026-05-30T00:00:00Z");
  const freshAt = (ageMs: number): string =>
    new Date(NOW - ageMs).toISOString();

  it("returns null when both chat and tools rows are missing (no-data)", () => {
    expect(resolveD4Row(mapOf([]), "agno", NOW)).toBeNull();
  });

  it("green chat + green tools (fresh) → green CHAT row (chat wins equal-rank ties)", () => {
    const live = mapOf([
      row("chat:agno", "chat", "green", { observed_at: freshAt(0) }),
      row("tools:agno", "tools", "green", { observed_at: freshAt(0) }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out).not.toBeNull();
    expect(out?.state).toBe("green");
    // Tie-break DIRECTION: the fold iterates [chatRow, toolsRow] with a
    // strict `>` rank comparison, so at equal rank the CHAT row must win.
    // Swapping the fold order to [toolsRow, chatRow] would return the
    // tools row here — these identity assertions pin the documented order.
    expect(out?.dimension).toBe("chat");
    expect(out?.key).toBe("chat:agno");
  });

  it("red chat + red tools (equal-rank red tie) → CHAT row identity returned", () => {
    // At an equal-rank RED tie the returned row's IDENTITY matters most:
    // its signal/fail_count surface in the drilldown, so the fold must
    // deterministically return the chat row, not whichever side happens
    // to win after an order swap.
    const live = mapOf([
      row("chat:agno", "chat", "red", {
        observed_at: freshAt(0),
        fail_count: 3,
      }),
      row("tools:agno", "tools", "red", {
        observed_at: freshAt(0),
        fail_count: 7,
      }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out).not.toBeNull();
    expect(out?.state).toBe("red");
    expect(out?.dimension).toBe("chat");
    expect(out?.key).toBe("chat:agno");
    expect(out?.fail_count).toBe(3);
  });

  it("green chat + red tools → red tools row wins the fold", () => {
    const live = mapOf([
      row("chat:agno", "chat", "green", { observed_at: freshAt(0) }),
      row("tools:agno", "tools", "red", { observed_at: freshAt(0) }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out?.state).toBe("red");
    expect(out?.dimension).toBe("tools");
  });

  it("red chat + green tools → red chat row wins the fold", () => {
    const live = mapOf([
      row("chat:agno", "chat", "red", { observed_at: freshAt(0) }),
      row("tools:agno", "tools", "green", { observed_at: freshAt(0) }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out?.state).toBe("red");
    expect(out?.dimension).toBe("chat");
  });

  it("stale-green chat alone (older than the 1h D4 window) → EFFECTIVE degraded row", () => {
    // D4 uses the 1h window (D4_STALE_AFTER_MS), NOT the 6h e2e window —
    // a 2h-old green chat row is stale for D4 but would be fresh for e2e.
    // The returned winner must be the EFFECTIVE (downgraded) row so `.state`
    // agrees with the rank that won the fold.
    const live = mapOf([
      row("chat:agno", "chat", "green", {
        observed_at: freshAt(D4_STALE_AFTER_MS + 60 * 60 * 1000),
      }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out).not.toBeNull();
    expect(out?.state).toBe("degraded");
  });

  it("green tools only (chat missing) → null (unverified family collapses, e771c2351)", () => {
    // `chat:<slug>` is producer-UNCONDITIONAL — a green tools row with the
    // chat row missing is an unverified family and must collapse to no-data.
    const live = mapOf([
      row("tools:agno", "tools", "green", { observed_at: freshAt(0) }),
    ]);
    expect(resolveD4Row(live, "agno", NOW)).toBeNull();
  });

  it("red tools only (chat missing) → red row returned (red dominates no-data)", () => {
    const live = mapOf([
      row("tools:agno", "tools", "red", { observed_at: freshAt(0) }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out).not.toBeNull();
    expect(out?.state).toBe("red");
    expect(out?.dimension).toBe("tools");
  });

  it("green chat only (tools missing) → green (conditional tools row stays lenient)", () => {
    const live = mapOf([
      row("chat:agno", "chat", "green", { observed_at: freshAt(0) }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out?.state).toBe("green");
    expect(out?.dimension).toBe("chat");
  });

  it("out-of-vocab tools state with chat missing still SURFACES (rank above red survives the collapse)", () => {
    // The missing-unconditional-chat collapse must be RANK-based, not a
    // `!== "red"` literal — an out-of-vocabulary "error" state is ranked
    // ABOVE red by the A2 machinery and must never be silently swallowed.
    const outOfVocab = "error" as unknown as StatusRow["state"];
    const live = mapOf([
      row("tools:agno", "tools", outOfVocab, { observed_at: freshAt(0) }),
    ]);
    const out = resolveD4Row(live, "agno", NOW);
    expect(out).not.toBeNull();
    expect(out?.state).toBe(outOfVocab);
  });
});

describe("resolveCell — post-Phase 3 (rollup uses health + e2e only)", () => {
  // Order: red > degraded > green > error > unknown.
  // Rollup contributors: health, e2e (Decision #7: smokeRow dropped).

  it("rolls up to red when any contributing dimension is red", () => {
    const live = mapOf([
      row("health:agno", "health", "red"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("red");
  });

  it("rolls up to degraded when no red but any degraded", () => {
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "degraded"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("amber");
  });

  it("rolls up to green only when health AND e2e are green (LS1)", () => {
    // Stale-green guard (LS1): a missing e2e row is NOT green-eligible —
    // the cell must read "gray" until the e2e probe has actually ticked.
    const liveBoth = mapOf([
      row("health:agno", "health", "green"),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    expect(resolveCell(liveBoth, "agno", "ac").rollup).toBe("green");

    const liveHealthOnly = mapOf([row("health:agno", "health", "green")]);
    expect(resolveCell(liveHealthOnly, "agno", "ac").rollup).toBe("gray");

    const liveE2eOnly = mapOf([row("e2e:agno/ac", "e2e", "green")]);
    expect(resolveCell(liveE2eOnly, "agno", "ac").rollup).toBe("gray");
  });

  it("an out-of-vocabulary contributor state (e.g. 'error') rolls up red-severity, never gray (A2)", () => {
    // `StatusRow.state` is typed State (green|red|degraded), but the harness
    // CAN persist an out-of-vocabulary value at runtime — notably "error"
    // (the no-data representation; see harness result-aggregator). The rollup
    // fold must route contributor states through the A2 rank machinery
    // (worstStateRank ranks an unknown state ABOVE red), not literal
    // includes() checks: a literal fold rolls the cell up GRAY (benign
    // no-data) while the contributor's own badge renders the loud "error"
    // tone — swallowing exactly the state the rank machinery exists to
    // surface.
    const outOfVocab = "error" as unknown as StatusRow["state"];
    const live = mapOf([
      row("health:agno", "health", outOfVocab),
      row("e2e:agno/ac", "e2e", "green"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).not.toBe("gray");
    expect(c.rollup).toBe("red");
  });

  it("rolls up to gray when no rows at all", () => {
    const live = mapOf([]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.rollup).toBe("gray");
  });

  it("hook-level error tone overrides missing-data (unknown) via connection param", () => {
    const live = mapOf([]);
    const c = resolveCell(live, "agno", "ac", { connection: "error" });
    expect(c.rollup).toBe("error");
  });

  it("full truth-table — red beats degraded beats green beats unknown", () => {
    const combos: Array<{
      health: StatusRow["state"] | null;
      e2e: StatusRow["state"] | null;
      expect: string;
    }> = [
      { health: "red", e2e: "green", expect: "red" },
      { health: "green", e2e: "red", expect: "red" },
      { health: "degraded", e2e: "green", expect: "amber" },
      { health: "green", e2e: "degraded", expect: "amber" },
      { health: "green", e2e: "green", expect: "green" },
      { health: "green", e2e: null, expect: "gray" },
      { health: null, e2e: "green", expect: "gray" },
      { health: null, e2e: null, expect: "gray" },
      { health: "red", e2e: "degraded", expect: "red" },
      { health: "degraded", e2e: "degraded", expect: "amber" },
    ];
    for (const c of combos) {
      const rows: StatusRow[] = [];
      if (c.health) rows.push(row("health:a", "health", c.health));
      if (c.e2e) rows.push(row("e2e:a/b", "e2e", c.e2e));
      const out = resolveCell(mapOf(rows), "a", "b");
      expect(out.rollup, JSON.stringify(c)).toBe(c.expect);
    }
  });

  it("per-badge tones match spec §5.4 table", () => {
    // smoke is integration-scoped (LS11): producer emits `smoke:<slug>`,
    // not `smoke:<slug>/<featureId>`.
    const live = mapOf([
      row("smoke:a", "smoke", "green"),
      row("health:a", "health", "red"),
      row("e2e:a/b", "e2e", "degraded"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.tone).toBe("green");
    expect(c.health.tone).toBe("red");
    expect(c.e2e.tone).toBe("amber");
  });

  it("smoke lookup uses integration-scoped key (LS11) — feature-keyed rows are NOT visible", () => {
    // Regression guard: pre-fix, resolveCell looked up `smoke:a/b`,
    // which always missed because the producer emits `smoke:a`. The
    // dashboard must populate the smoke badge from the integration-
    // scoped key.
    const live = mapOf([
      row("smoke:a", "smoke", "red"),
      // A bogus per-feature smoke row must NOT bleed into resolveCell.
      row("smoke:a/b", "smoke", "green"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.tone).toBe("red");
    expect(c.smoke.row?.key).toBe("smoke:a");
  });

  it("unknown badges render label '?' and tone 'gray'", () => {
    const c = resolveCell(mapOf([]), "a", "b");
    expect(c.smoke.tone).toBe("gray");
    expect(c.smoke.label).toBe("?");
    expect(c.health.tone).toBe("gray");
    expect(c.health.label).toBe("?");
  });

  it("all-green rows + connection=error: rollup is error, NOT stale-green (R5 F5.1)", () => {
    const live = mapOf([
      row("health:a", "health", "green"),
      row("e2e:a/b", "e2e", "green"),
    ]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.rollup).toBe("error");
    expect(c.rollup).not.toBe("green");
  });

  it("red row + connection=error: red wins over the hook error tone (C5 F14)", () => {
    const live = mapOf([row("health:a", "health", "red")]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.rollup).toBe("red");
  });

  it("degraded does NOT render a green check glyph (C5 F12)", () => {
    const live = mapOf([
      row("smoke:a", "smoke", "degraded"),
      row("e2e:a/b", "e2e", "degraded"),
      row("health:a", "health", "degraded"),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.smoke.label).not.toBe("✓");
    expect(c.e2e.label).not.toBe("✓");
    expect(c.health.label).not.toBe("up");
    expect(c.health.label).not.toBe("?");
  });

  it("CellState no longer has qa property", () => {
    const c = resolveCell(mapOf([]), "a", "b");
    expect(c).not.toHaveProperty("qa");
  });

  it("resolves d2 (agent) integration-scoped row when present", () => {
    const live = mapOf([row("agent:agno", "agent", "green")]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d2.tone).toBe("green");
    expect(c.d2.label).toBe("✓");
    expect(c.d2.row?.key).toBe("agent:agno");
  });

  it("falls through to gray '?' when d2 (agent) row is absent", () => {
    const c = resolveCell(mapOf([]), "agno", "agentic-chat");
    expect(c.d2.tone).toBe("gray");
    expect(c.d2.label).toBe("?");
    expect(c.d2.row).toBeNull();
  });

  it("d2 (agent) does NOT contribute to the rollup (informational only)", () => {
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("agent:agno", "agent", "red"),
    ]);
    const c = resolveCell(live, "agno", "ac");
    // health is green but e2e is missing → rollup is gray (not red from agent)
    expect(c.rollup).toBe("gray");
    expect(c.d2.tone).toBe("red");
  });

  it("resolves d5 / d6 per-feature rows when present", () => {
    // D5 AND D6 use per-feature keys (`<dim>:<slug>/<featureType>`), both
    // mapped from catalog featureId via CATALOG_TO_D5_KEY. The aggregate
    // `d6:<slug>` here (green) must NOT be read — the per-cell row wins.
    const live = mapOf([
      row("d5:agno/agentic-chat", "d5", "green"),
      // aggregate green distractor — not consulted:
      row("d6:agno", "d6", "green"),
      // per-cell red is what the badge surfaces:
      row("d6:agno/agentic-chat", "d6", "red"),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d5.tone).toBe("green");
    expect(c.d5.label).toBe("✓");
    expect(c.d5.row?.key).toBe("d5:agno/agentic-chat");
    expect(c.d6.tone).toBe("red");
    expect(c.d6.label).toBe("✗");
    expect(c.d6.row?.key).toBe("d6:agno/agentic-chat");
  });

  it("falls through to gray '?' when d5 / d6 rows are absent", () => {
    // Resting state for D6 cells outside their weekly-rotation slot — the
    // missing row must NOT panic-render or shift the rollup tone.
    const c = resolveCell(mapOf([]), "agno", "agentic-chat");
    expect(c.d5.tone).toBe("gray");
    expect(c.d5.label).toBe("?");
    expect(c.d6.tone).toBe("gray");
    expect(c.d6.label).toBe("?");
    expect(c.d5.row).toBeNull();
    expect(c.d6.row).toBeNull();
  });

  it("resolves d4 from integration-scoped chat+tools rows (green fold)", () => {
    const live = mapOf([
      row("chat:agno", "chat", "green"),
      row("tools:agno", "tools", "green"),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d4.tone).toBe("green");
    expect(c.d4.label).toBe("✓");
  });

  it("d4 red tools + green chat → red badge anchored on the tools row", () => {
    const live = mapOf([
      row("chat:agno", "chat", "green"),
      row("tools:agno", "tools", "red"),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d4.tone).toBe("red");
    expect(c.d4.label).toBe("✗");
    expect(c.d4.row?.dimension).toBe("tools");
  });

  it("d4 does NOT contribute to the rollup (informational only — Service scope is health + e2e)", () => {
    // The pill's gate already consumes D4 via buildCellModel; the rollup's
    // contributors stay health + e2e (the relabel decision). A red D4 fold
    // must surface on its own badge while the service rollup stays green.
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("e2e:agno/agentic-chat", "e2e", "green"),
      row("chat:agno", "chat", "green"),
      row("tools:agno", "tools", "red"),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d4.tone).toBe("red");
    expect(c.rollup).toBe("green");
  });

  it("d4 stale-green chat (older than the 1h window) → amber badge with stale tooltip", () => {
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const live = mapOf([
      row("chat:agno", "chat", "green", {
        observed_at: new Date(
          NOW - (D4_STALE_AFTER_MS + 60 * 60 * 1000),
        ).toISOString(),
      }),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat", { now: NOW });
    expect(c.d4.tone).toBe("amber");
    expect(c.d4.tooltip).toContain("stale");
  });

  it("d4 falls through to gray '?' when chat/tools rows are absent", () => {
    const c = resolveCell(mapOf([]), "agno", "agentic-chat");
    expect(c.d4.tone).toBe("gray");
    expect(c.d4.label).toBe("?");
    expect(c.d4.row).toBeNull();
  });

  it("d5 / d6 do NOT contribute to the rollup (informational only)", () => {
    // Mirrors smoke's post-Phase-3 behaviour: a red d5/d6 row alone must
    // not flip the cell's rollup to red — the alert engine routes those
    // dimensions independently. Only health + e2e drive the rollup.
    // Note: with LS1 in force, health-only does NOT roll up to green
    // (e2e is also required); rollup is "gray" and the red d5/d6 rows
    // must not promote it to red.
    // D5 AND D6 use per-feature keys (`<dim>:<slug>/<featureType>`), mapped
    // via CATALOG_TO_D5_KEY. `agentic-chat` is a real single-key family;
    // both its d5/d6 rows resolve through the mapped per-cell path.
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("d5:agno/agentic-chat", "d5", "red"),
      row("d6:agno/agentic-chat", "d6", "red"),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.rollup).toBe("gray");
    expect(c.d5.tone).toBe("red");
    expect(c.d6.tone).toBe("red");
  });

  it("d5 degraded renders amber tone with '~' label (not green check)", () => {
    // `agentic-chat` is a mapped single-key D5 family; a degraded sub-row
    // folds through resolveD5Row's worst-state path to amber.
    const live = mapOf([row("d5:agno/agentic-chat", "d5", "degraded")]);
    const c = resolveCell(live, "agno", "agentic-chat");
    expect(c.d5.tone).toBe("amber");
    expect(c.d5.label).toBe("~");
  });

  it("d5 / d6 lookups ignore unrelated keys", () => {
    // Defensive: an `e2e:slug/feature` row must not be visible through
    // the d5 / d6 slots even if a key resolver bug confused dimensions.
    const live = mapOf([row("e2e:agno/ac", "e2e", "red")]);
    const c = resolveCell(live, "agno", "ac");
    expect(c.d5.row).toBeNull();
    expect(c.d6.row).toBeNull();
  });

  // ── multi-key D5 fan-out (e.g. beautiful-chat → 5 per-pill keys) ──
  // The CATALOG_TO_D5_KEY mapping fans some catalog feature IDs to
  // multiple D5 keys (beautiful-chat → 5 per-pill literals). The
  // rolled-up cell must reflect the WORST-state row in the family —
  // red > degraded > green — so a single amber pill turns the badge
  // amber instead of staying green behind a co-iterated green sibling.
  it("d5 multi-key fan-out: red beats green when red comes after green", () => {
    // All 5 mapped sub-rows present so the worst-state fold — not STRICT
    // missing handling — is what credits red. (A red still dominates a
    // missing sub-row, but emitting the full family pins the fold ordering.)
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "red"),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green"),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d5.tone).toBe("red");
    expect(c.d5.label).toBe("✗");
  });

  it("d5 multi-key fan-out: red beats green when red comes BEFORE green", () => {
    // All 5 mapped sub-rows present so the worst-state fold — not STRICT
    // missing handling — is what credits red, with red listed FIRST to pin
    // order-independence of the fold.
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "red"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green"),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d5.tone).toBe("red");
  });

  it("d5 multi-key fan-out: degraded beats green regardless of iteration order", () => {
    // Pre-fix regression: only `red` could replace `worst`, so a degraded
    // row encountered after a green row was silently dropped and the
    // badge stayed green. With the fix, degraded > green wins.
    // All 5 mapped sub-rows are present (STRICT requires a full family before
    // a non-red fold is credited) so the fold — not missing handling — is
    // what's under test.
    const liveGreenFirst = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "degraded"),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green"),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    expect(resolveCell(liveGreenFirst, "agno", "beautiful-chat").d5.tone).toBe(
      "amber",
    );

    const liveDegradedFirst = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "degraded"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green"),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    expect(
      resolveCell(liveDegradedFirst, "agno", "beautiful-chat").d5.tone,
    ).toBe("amber");
  });

  it("d5 multi-key fan-out: red beats degraded", () => {
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "degraded"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "red"),
    ]);
    expect(resolveCell(live, "agno", "beautiful-chat").d5.tone).toBe("red");
  });

  it("d5 multi-key fan-out: all green stays green", () => {
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green"),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green"),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green"),
    ]);
    expect(resolveCell(live, "agno", "beautiful-chat").d5.tone).toBe("green");
  });

  // ── STRICT missing-sub-row handling (mirrors cell-model.ts resolveD5) ──
  // A multi-key family is credited green ONLY when EVERY mapped sub-row is
  // present and (post-stale) green. A missing mapped sub-row makes the family
  // unverified → no-data (gray "?"), NOT a green badge. A present red still
  // dominates no-data and surfaces red. This matches buildCellModel's D5.
  it("d5 multi-key fan-out: one present-green + missing sub-rows → NOT green (gray no-data)", () => {
    // beautiful-chat maps to 5 sub-keys; emit only 1 (one present-green,
    // four missing). Pre-fix this rendered a false-green d5 badge while
    // buildCellModel's D5 rendered gray.
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green"),
      // pie-chart, bar-chart, search-flights, schedule-meeting omitted.
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d5.tone).not.toBe("green");
    expect(c.d5.tone).toBe("gray");
    expect(c.d5.label).toBe("?");
    expect(c.d5.row).toBeNull();
  });

  it("d5 multi-key fan-out: present-red + a missing sub-row → red (red dominates no-data)", () => {
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green"),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "red"),
      // bar-chart, search-flights, schedule-meeting omitted.
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat");
    expect(c.d5.tone).toBe("red");
    expect(c.d5.label).toBe("✗");
  });

  // ── unmapped feature: no direct-key fallback (mirrors cell-model.ts
  //    resolveD5 / depth-utils.ts isD5Green) ──
  // A feature NOT in CATALOG_TO_D5_KEY has no 1P test, so its D5 badge must
  // be gray "?" even when a direct `d5:<slug>/<featureId>` row exists in the
  // map. Pre-fix, resolveD5Row fell back to the direct key and rendered the
  // row's tone (green), contradicting the coverage chip (resolveD5 returns
  // exists:false) and deriveDepth (isD5Green returns false). The fallback was
  // removed from isD5Green because it "could resolve true from stale/shared
  // PB rows, granting D5 to cells without 1P tests" — resolveD5Row must match.
  it("d5 unmapped feature: present direct-key row does NOT render green (matches chip)", () => {
    // `some-unmapped-feature` is intentionally absent from CATALOG_TO_D5_KEY.
    const live = mapOf([row("d5:agno/some-unmapped-feature", "d5", "green")]);
    const c = resolveCell(live, "agno", "some-unmapped-feature");
    expect(c.d5.tone).not.toBe("green");
    expect(c.d5.tone).toBe("gray");
    expect(c.d5.label).toBe("?");
    expect(c.d5.row).toBeNull();
  });

  it("d5 multi-key fan-out: stale-green sub-row listed FIRST folds to amber (order-independent)", () => {
    // Mirrors cell-model.test.ts's staleFirst coverage to pin order-
    // independence of the stale fold. A stale-green sub-row listed FIRST must
    // still force the full (otherwise-fresh-green) family to amber — the fold
    // does not depend on CATALOG_TO_D5_KEY order. All 5 sub-rows present so
    // STRICT missing handling is satisfied and the fold is what's exercised.
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const staleAt = new Date(
      NOW - (E2E_STALE_AFTER_MS + 60 * 60 * 1000),
    ).toISOString();
    const freshAt = new Date(NOW).toISOString();
    const live = mapOf([
      // Stale-green listed FIRST.
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green", {
        observed_at: staleAt,
      }),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "green", {
        observed_at: freshAt,
      }),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green", {
        observed_at: freshAt,
      }),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green", {
        observed_at: freshAt,
      }),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green", {
        observed_at: freshAt,
      }),
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat", { now: NOW });
    expect(c.d5.tone).not.toBe("green");
    expect(c.d5.tone).toBe("amber");
  });
});

describe("resolveCell — staleness downgrade (unification A)", () => {
  // A fixed `now` so the stale/fresh boundary is deterministic.
  const NOW = Date.parse("2026-05-30T00:00:00Z");
  const freshAt = (ageMs: number): string =>
    new Date(NOW - ageMs).toISOString();

  it("stale-green e2e → rollup not-green + e2e badge amber", () => {
    // e2e uses the 6h window. A green e2e row older than that must downgrade
    // to amber so the frozen-green driver no longer credits D3.
    const live = mapOf([
      row("health:agno", "health", "green", { observed_at: freshAt(0) }),
      row("e2e:agno/ac", "e2e", "green", {
        observed_at: freshAt(E2E_STALE_AFTER_MS + 60 * 60 * 1000),
      }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.rollup).not.toBe("green");
    expect(c.rollup).toBe("amber");
    expect(c.e2e.tone).toBe("amber");
  });

  it("fresh-green e2e + fresh-green health → stays green", () => {
    const live = mapOf([
      row("health:agno", "health", "green", { observed_at: freshAt(0) }),
      row("e2e:agno/ac", "e2e", "green", { observed_at: freshAt(0) }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.rollup).toBe("green");
    expect(c.e2e.tone).toBe("green");
    expect(c.health.tone).toBe("green");
  });

  it("stale-green health → rollup not-green + health badge amber (45m window)", () => {
    // health uses the tighter liveness window. A green health row just past
    // 45m downgrades; an e2e row inside its 6h window stays green.
    const live = mapOf([
      row("health:agno", "health", "green", {
        observed_at: freshAt(LIVENESS_STALE_AFTER_MS + 60 * 1000),
      }),
      row("e2e:agno/ac", "e2e", "green", { observed_at: freshAt(0) }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.rollup).not.toBe("green");
    expect(c.rollup).toBe("amber");
    expect(c.health.tone).toBe("amber");
  });

  it("per-dimension windows: e2e green at 1h is NOT stale (under 6h)", () => {
    // 1h is well within the e2e window — must stay green.
    const live = mapOf([
      row("health:agno", "health", "green", { observed_at: freshAt(0) }),
      row("e2e:agno/ac", "e2e", "green", {
        observed_at: freshAt(60 * 60 * 1000),
      }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.rollup).toBe("green");
    expect(c.e2e.tone).toBe("green");
  });

  it("per-dimension windows: health green at 1h IS stale (over 45m)", () => {
    // 1h exceeds the liveness window — health must downgrade even though the
    // same age would be fresh for e2e.
    const live = mapOf([
      row("health:agno", "health", "green", {
        observed_at: freshAt(60 * 60 * 1000),
      }),
      row("e2e:agno/ac", "e2e", "green", { observed_at: freshAt(0) }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.health.tone).toBe("amber");
    expect(c.rollup).toBe("amber");
  });

  it("stale-green d5 badge downgrades to amber (per-sub-row fold, 6h window)", () => {
    // resolveD5Row applies the per-sub-row stale fold BEFORE worst-state, so
    // any stale-green sub-row forces the family amber. All 5 mapped sub-rows
    // are present so STRICT missing handling is satisfied and the stale fold
    // is what's under test.
    const live = mapOf([
      row("d5:agno/beautiful-chat-toggle-theme", "d5", "green", {
        observed_at: freshAt(0),
      }),
      row("d5:agno/beautiful-chat-pie-chart", "d5", "green", {
        observed_at: freshAt(E2E_STALE_AFTER_MS + 60 * 60 * 1000),
      }),
      row("d5:agno/beautiful-chat-bar-chart", "d5", "green", {
        observed_at: freshAt(0),
      }),
      row("d5:agno/beautiful-chat-search-flights", "d5", "green", {
        observed_at: freshAt(0),
      }),
      row("d5:agno/beautiful-chat-schedule-meeting", "d5", "green", {
        observed_at: freshAt(0),
      }),
    ]);
    const c = resolveCell(live, "agno", "beautiful-chat", { now: NOW });
    expect(c.d5.tone).toBe("amber");
  });

  it("stale-green d6 badge downgrades to amber (6h window)", () => {
    // D6 is per-cell (d6:<slug>/<featureType>), so use a mapped feature.
    const live = mapOf([
      row("d6:agno/agentic-chat", "d6", "green", {
        observed_at: freshAt(E2E_STALE_AFTER_MS + 60 * 60 * 1000),
      }),
    ]);
    const c = resolveCell(live, "agno", "agentic-chat", { now: NOW });
    expect(c.d6.tone).toBe("amber");
  });

  it("stale-green smoke / d2 badges downgrade to amber (45m window)", () => {
    const live = mapOf([
      row("smoke:agno", "smoke", "green", {
        observed_at: freshAt(LIVENESS_STALE_AFTER_MS + 60 * 1000),
      }),
      row("agent:agno", "agent", "green", {
        observed_at: freshAt(LIVENESS_STALE_AFTER_MS + 60 * 1000),
      }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.smoke.tone).toBe("amber");
    expect(c.d2.tone).toBe("amber");
  });

  it("stale-green badge returns the EFFECTIVE (downgraded) row, not the raw green row", () => {
    // buildBadge must return row: effRow so .row.state agrees with .tone.
    // Pre-fix the badge had tone:"amber" while badge.row.state==="green" —
    // a latent false-green any consumer reading .row.state would hit.
    const live = mapOf([
      row("e2e:agno/ac", "e2e", "green", {
        observed_at: freshAt(E2E_STALE_AFTER_MS + 60 * 60 * 1000),
      }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.e2e.tone).toBe("amber");
    expect(c.e2e.row?.state).toBe("degraded");
    expect(c.e2e.row?.state).not.toBe("green");
    // Drilldown metadata preserved by the spread.
    expect(c.e2e.row?.key).toBe("e2e:agno/ac");
  });

  it("stale RED row is left as-is (only green is downgraded)", () => {
    const live = mapOf([
      row("e2e:agno/ac", "e2e", "red", {
        observed_at: freshAt(E2E_STALE_AFTER_MS + 60 * 60 * 1000),
      }),
    ]);
    const c = resolveCell(live, "agno", "ac", { now: NOW });
    expect(c.e2e.tone).toBe("red");
    expect(c.rollup).toBe("red");
  });
});

describe("resolveD5Row / resolveD6Row — effective (stale-downgraded) winner (G2f)", () => {
  const NOW = Date.parse("2026-05-30T00:00:00Z");
  const staleAt = new Date(
    NOW - E2E_STALE_AFTER_MS - 60 * 60 * 1000,
  ).toISOString();
  const freshAt = new Date(NOW).toISOString();

  it("resolveD5Row returns the EFFECTIVE row for a stale-green winner (.row.state agrees with the fold)", () => {
    // The fold ranks the stale-green sub-row as degraded, but the resolver
    // used to store the RAW row — a consumer reading .state saw a latent
    // false-green that contradicted the rank that made it the winner.
    // Mirrors cell-model.ts resolveD5's effective-row storage.
    const live = mapOf([
      row("d5:agno/agentic-chat", "d5", "green", { observed_at: staleAt }),
    ]);
    const r = resolveD5Row(live, "agno", "agentic-chat", NOW);
    expect(r?.state).toBe("degraded");
    // Producer fields preserved by the spread (drilldown metadata intact).
    expect(r?.key).toBe("d5:agno/agentic-chat");
    expect(r?.observed_at).toBe(staleAt);
  });

  it("resolveD6Row returns the EFFECTIVE row for a stale-green winner", () => {
    const live = mapOf([
      row("d6:agno/agentic-chat", "d6", "green", { observed_at: staleAt }),
    ]);
    const r = resolveD6Row(live, "agno", "agentic-chat", NOW);
    expect(r?.state).toBe("degraded");
  });

  it("a fresh winner row passes through by reference, unmodified", () => {
    const fresh = row("d5:agno/agentic-chat", "d5", "green", {
      observed_at: freshAt,
    });
    const live = mapOf([fresh]);
    expect(resolveD5Row(live, "agno", "agentic-chat", NOW)).toBe(fresh);
  });
});

describe("formatTooltip behaviour (via resolveCell)", () => {
  it("degraded tooltip drops the hardcoded '>6h' threshold (LS2)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "degraded", {
        observed_at: "2026-04-22T08:00:00Z",
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).not.toMatch(/>6h/);
    expect(c.e2e.tooltip).toContain("stale");
    expect(c.e2e.tooltip).toContain(formatTs("2026-04-22T08:00:00Z"));
  });

  // D1: `observed_at` on a degraded row is when the dim was last *seen*
  // (most recent tick recorded that state), NOT when it last *passed*.
  // The tooltip copy must reflect that — operators reading
  // "last pass @ ..." would think the dim last went green at that
  // timestamp, when it was actually still degraded then.
  it("degraded tooltip says 'last seen' not 'last pass' (D1)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "degraded", {
        observed_at: "2026-04-22T08:00:00Z",
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).toContain(
      `last seen @ ${formatTs("2026-04-22T08:00:00Z")}`,
    );
    expect(c.e2e.tooltip).not.toContain("last pass");
  });

  it("a FRESH producer-emitted degraded row says 'degraded', not 'stale' (G2f)", () => {
    // The producer genuinely emitted `degraded` on a recent tick: labeling
    // that "stale" told operators the row had stopped updating when the
    // signal is actually fresh-and-degraded. The stale copy is reserved for
    // rows that fail the SAME staleness check the badge tone uses.
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const freshTs = new Date(NOW - 60 * 1000).toISOString();
    const live = mapOf([
      row("e2e:a/b", "e2e", "degraded", {
        observed_at: freshTs,
        transitioned_at: freshTs,
      }),
    ]);
    const c = resolveCell(live, "a", "b", { now: NOW });
    expect(c.e2e.tooltip).toContain("degraded since");
    expect(c.e2e.tooltip).not.toContain("stale");
  });

  it("an age-downgraded green row keeps the 'stale — last seen' copy (G2f)", () => {
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const oldTs = new Date(
      NOW - E2E_STALE_AFTER_MS - 60 * 60 * 1000,
    ).toISOString();
    const live = mapOf([
      row("e2e:a/b", "e2e", "green", { observed_at: oldTs }),
    ]);
    const c = resolveCell(live, "a", "b", { now: NOW });
    expect(c.e2e.tone).toBe("amber");
    expect(c.e2e.tooltip).toContain(`stale — last seen @ ${formatTs(oldTs)}`);
  });

  // The health LABEL must honor the same staleness split as the tooltip —
  // formatLabel hardcoding "stale" for every degraded health row contradicted
  // the "degraded since …" tooltip on a fresh producer-emitted degradation.
  it("a FRESH producer-emitted degraded health row labels 'degraded', not 'stale'", () => {
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const freshTs = new Date(NOW - 60 * 1000).toISOString();
    const live = mapOf([
      row("health:a", "health", "degraded", {
        observed_at: freshTs,
        transitioned_at: freshTs,
      }),
    ]);
    const c = resolveCell(live, "a", "b", { now: NOW });
    expect(c.health.label).toBe("degraded");
    expect(c.health.tooltip).toContain("degraded since");
  });

  it("a degraded health row that stopped updating keeps the 'stale' label", () => {
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const oldTs = new Date(
      NOW - LIVENESS_STALE_AFTER_MS - 60 * 1000,
    ).toISOString();
    const live = mapOf([
      row("health:a", "health", "degraded", {
        observed_at: oldTs,
        transitioned_at: oldTs,
      }),
    ]);
    const c = resolveCell(live, "a", "b", { now: NOW });
    expect(c.health.label).toBe("stale");
    expect(c.health.tooltip).toContain("stale — last seen");
  });

  it("an age-downgraded green health row labels 'stale' (the row froze while green)", () => {
    const NOW = Date.parse("2026-05-30T00:00:00Z");
    const oldTs = new Date(
      NOW - LIVENESS_STALE_AFTER_MS - 60 * 1000,
    ).toISOString();
    const live = mapOf([
      row("health:a", "health", "green", { observed_at: oldTs }),
    ]);
    const c = resolveCell(live, "a", "b", { now: NOW });
    expect(c.health.tone).toBe("amber");
    expect(c.health.label).toBe("stale");
  });

  it("red tooltip surfaces non-empty signal summary (LS8)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "red", {
        signal: { reason: "timeout", attempt: 3 },
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).toContain("red since");
    expect(c.e2e.tooltip).toContain("timeout");
  });

  it("red tooltip omits signal suffix when signal is empty object (LS8)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "red", {
        signal: {},
      }),
    ]);
    const c = resolveCell(live, "a", "b");
    expect(c.e2e.tooltip).toMatch(/^e2e red since /);
    expect(c.e2e.tooltip).not.toContain("—");
  });

  it("red tooltip truncates long signal summaries to 80 chars (LS8)", () => {
    const long = "x".repeat(500);
    const live = mapOf([row("e2e:a/b", "e2e", "red", { signal: long })]);
    const c = resolveCell(live, "a", "b");
    // Truncation marker present, total signal segment <= 80 chars.
    expect(c.e2e.tooltip).toContain("...");
    const sigPart = c.e2e.tooltip.split(" — ")[1] ?? "";
    expect(sigPart.length).toBeLessThanOrEqual(80);
  });

  it("connection=error + red row: appends last-known-state context (LS9)", () => {
    const live = mapOf([
      row("e2e:a/b", "e2e", "red", {
        transitioned_at: "2026-04-22T09:00:00Z",
      }),
    ]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.e2e.tooltip).toContain("dashboard offline (§5.3)");
    expect(c.e2e.tooltip).toContain("last observed");
    expect(c.e2e.tooltip).toContain("e2e red");
    expect(c.e2e.tooltip).toContain(formatTs("2026-04-22T09:00:00Z"));
  });

  it("connection=error + green row: plain offline tooltip (no last-observed context)", () => {
    const live = mapOf([row("e2e:a/b", "e2e", "green")]);
    const c = resolveCell(live, "a", "b", { connection: "error" });
    expect(c.e2e.tooltip).toBe("dashboard offline (§5.3)");
  });

  it("connection=error + null row: plain offline tooltip", () => {
    const c = resolveCell(mapOf([]), "a", "b", { connection: "error" });
    expect(c.e2e.tooltip).toBe("dashboard offline (§5.3)");
  });
});

/* ------------------------------------------------------------------ */
/*  Starter row-group (spec §d / §a)                                    */
/* ------------------------------------------------------------------ */

const NOW = Date.now();

describe("STARTER_COLUMNS (§a 12-mapped / 7-not-supported split)", () => {
  it("contains exactly the 12 mapped columns", () => {
    // 12 mapped + 7 not-supported = 19 columns. Guards the dashboard's copy
    // of the harness STARTER_TO_COLUMN value set against silent rot.
    expect(STARTER_COLUMNS.size).toBe(12);
  });

  it("includes the 5 drift columns and 7 direct columns", () => {
    for (const col of [
      "google-adk",
      "langgraph-typescript",
      "strands",
      "ms-agent-dotnet",
      "ms-agent-python",
      "crewai-crews",
      "langgraph-fastapi",
      "langgraph-python",
      "agno",
      "llamaindex",
      "mastra",
      "pydantic-ai",
    ]) {
      expect(starterIsSupported(col)).toBe(true);
    }
  });

  it("treats the 7 unmapped columns as not supported", () => {
    for (const col of [
      "ag2",
      "claude-sdk-python",
      "claude-sdk-typescript",
      "langroid",
      "spring-ai",
      "built-in-agent",
      "ms-agent-harness-dotnet",
    ]) {
      expect(starterIsSupported(col)).toBe(false);
    }
  });
});

describe("resolveStarterRow", () => {
  it("looks up the flat starter:<col>/<level> key", () => {
    const r = row("starter:agno/health", "starter", "green");
    const live = mapOf([r]);
    expect(resolveStarterRow(live, "agno", "health")).toBe(r);
  });

  it("returns null for a column/level with no row (not-yet-run)", () => {
    expect(resolveStarterRow(mapOf([]), "agno", "chat")).toBeNull();
  });

  it("does not cross-contaminate levels", () => {
    const live = mapOf([row("starter:agno/agent", "starter", "red")]);
    expect(resolveStarterRow(live, "agno", "agent")?.state).toBe("red");
    expect(resolveStarterRow(live, "agno", "health")).toBeNull();
  });
});

describe("buildStarterBadge — 5-state cell vocabulary (§d)", () => {
  it("✓ healthy: green row → green ✓", () => {
    const b = buildStarterBadge(
      "health",
      true,
      row("starter:agno/health", "starter", "green"),
      NOW,
      "live",
    );
    expect(b.tone).toBe("green");
    expect(b.label).toBe("✓");
  });

  it("red ✗ smoke-failed: red row → red ✗", () => {
    const b = buildStarterBadge(
      "chat",
      true,
      row("starter:agno/chat", "starter", "red"),
      NOW,
      "live",
    );
    expect(b.tone).toBe("red");
    expect(b.label).toBe("✗");
  });

  it("~ stale: green row older than STARTER_STALE_AFTER_MS downgrades to amber ~", () => {
    const stale = row("starter:agno/agent", "starter", "green", {
      observed_at: new Date(NOW - STARTER_STALE_AFTER_MS - 1).toISOString(),
    });
    const b = buildStarterBadge("agent", true, stale, NOW, "live");
    expect(b.tone).toBe("amber");
    expect(b.label).toBe("~");
    // The downgraded effective row's state agrees with the tone.
    expect(b.row?.state).toBe("degraded");
  });

  it("~ stale boundary: green row EXACTLY at the window is NOT stale (strict >)", () => {
    const atBoundary = row("starter:agno/agent", "starter", "green", {
      observed_at: new Date(NOW - STARTER_STALE_AFTER_MS).toISOString(),
    });
    const b = buildStarterBadge("agent", true, atBoundary, NOW, "live");
    expect(b.tone).toBe("green");
    expect(b.label).toBe("✓");
  });

  // Hourly-cadence derivation (starter_smoke.yml `schedule: "40 * * * *"`,
  // 1h probe period; STARTER_STALE_AFTER_MS = 2.5h). These pin the window to
  // the hourly basis: a single missed tick (last row ~2h old) MUST stay green;
  // two consecutive misses (last row ~3h old) MUST flip amber.
  const ONE_HOUR_MS = 60 * 60 * 1000;

  it("window is strictly > 2 hourly probe periods and < 3 (derived 2.5h)", () => {
    expect(STARTER_STALE_AFTER_MS).toBeGreaterThan(2 * ONE_HOUR_MS);
    expect(STARTER_STALE_AFTER_MS).toBeLessThan(3 * ONE_HOUR_MS);
  });

  it("single missed hourly tick (~2h old) stays green", () => {
    const oneMiss = row("starter:agno/agent", "starter", "green", {
      observed_at: new Date(NOW - 2 * ONE_HOUR_MS).toISOString(),
    });
    const b = buildStarterBadge("agent", true, oneMiss, NOW, "live");
    expect(b.tone).toBe("green");
    expect(b.label).toBe("✓");
  });

  it("two consecutive missed hourly ticks (~3h old) flip amber ~", () => {
    const twoMisses = row("starter:agno/agent", "starter", "green", {
      observed_at: new Date(NOW - 3 * ONE_HOUR_MS).toISOString(),
    });
    const b = buildStarterBadge("agent", true, twoMisses, NOW, "live");
    expect(b.tone).toBe("amber");
    expect(b.label).toBe("~");
    expect(b.row?.state).toBe("degraded");
  });

  it("gray ?: supported column, no row yet → gray ? (not-yet-run)", () => {
    const b = buildStarterBadge("interaction", true, null, NOW, "live");
    expect(b.tone).toBe("gray");
    expect(b.label).toBe("?");
  });

  it("not-supported 🚫: unmapped column → 🚫 unsupported chip, mapping-derived (not data-derived)", () => {
    // Keyed off isSupported=false, NOT off a missing row. An integration with
    // NO starter is architecturally unsupported in the starter row, so it
    // renders the SAME 🚫 "Not supported by this framework" treatment the
    // depth-chip/unified-cell already use — NOT a grey/no-data `?`, and NOT a
    // red smoke-failed `✗` (which would mis-communicate "we tried and failed").
    const b = buildStarterBadge("health", false, null, NOW, "live");
    expect(b.label).toBe("🚫");
    expect(b.tooltip).toBe("Not supported by this framework");
    // It must be visually distinct from a data-bearing red FAIL: never red.
    expect(b.tone).not.toBe("red");
    expect(b.row).toBeNull();
  });

  it("not-supported 🚫 is independent of any row data (mapping wins)", () => {
    // Even if a stray row existed, an unmapped column must still render the
    // not-supported 🚫 state — the caller passes row=null for unmapped columns,
    // but assert buildStarterBadge ignores row entirely when !isSupported.
    const b = buildStarterBadge(
      "health",
      false,
      row("starter:ag2/health", "starter", "green"),
      NOW,
      "live",
    );
    expect(b.label).toBe("🚫");
    expect(b.tone).not.toBe("red");
  });

  it("supported column with a genuinely-red row still renders red ✗ (NOT masked as 🚫)", () => {
    // Guard the inverse: only ABSENT starters become 🚫. A starter that exists
    // and FAILED must keep surfacing its real red ✗ — never reframed as
    // "unsupported".
    const b = buildStarterBadge(
      "chat",
      true,
      row("starter:agno/chat", "starter", "red"),
      NOW,
      "live",
    );
    expect(b.tone).toBe("red");
    expect(b.label).toBe("✗");
    expect(b.label).not.toBe("🚫");
  });

  it("tooltip carries the per-level descriptor for data-bearing states", () => {
    const expected: Record<StarterLevel, string> = {
      health: "health endpoint responded",
      agent: "agent endpoint reachable (non-404)",
      chat: "chat round-trip via aimock returned a response",
      interaction: "UI interactions work, no console errors",
    };
    for (const level of STARTER_LEVELS) {
      const b = buildStarterBadge(
        level,
        true,
        row(`starter:agno/${level}`, "starter", "green"),
        NOW,
        "live",
      );
      expect(b.tooltip).toContain(expected[level]);
    }
  });
});

describe("buildStarterBadge — two-miss tolerance for SOFT errorClass (pool-fleet step C)", () => {
  // The starter-smoke driver keys failures by class (mirror of harness
  // `StarterFailureClass`): SOFT = `transport-error` / `aborted` (transient
  // transport / cold-start / abort hiccups), HARD = `smoke-failed` (a real
  // HTTP-level content regression). A SOFT miss must NOT flip the cell red on
  // the FIRST occurrence — the producer's `fail_count` (the persisted
  // consecutive-red counter: 1 on green→red, incremented on sustained red,
  // 0 on red→green) gates the flip: tolerate while `fail_count <= 1`, flip on
  // `fail_count >= 2` (two consecutive misses). HARD failures flip immediately
  // regardless of `fail_count`.
  //
  // A tolerated soft miss renders AMBER `~` (degraded), NOT green: the probe
  // literally just failed, so claiming a green ✓ would be a false-green lie
  // (the codebase guards against false-green everywhere). Amber says
  // "transient, not yet actionable" — distinct from both the flap-to-red and
  // the dishonest green.

  function softRedRow(
    errorClass: "transport-error" | "aborted",
    failCount: number,
  ): StatusRow {
    return row("starter:agno/agent", "starter", "red", {
      signal: { errorClass },
      fail_count: failCount,
      first_failure_at: FRESH_OBSERVED_AT,
    });
  }

  it("(a) single SOFT transport-error miss (fail_count=1) is TOLERATED — does NOT flip red", () => {
    const b = buildStarterBadge(
      "agent",
      true,
      softRedRow("transport-error", 1),
      NOW,
      "live",
    );
    expect(b.tone).not.toBe("red");
    expect(b.label).not.toBe("✗");
    // Tolerated → amber `~`, not a dishonest green ✓.
    expect(b.tone).toBe("amber");
    expect(b.label).toBe("~");
  });

  it("(a') single SOFT aborted miss (fail_count=1) is TOLERATED — does NOT flip red", () => {
    const b = buildStarterBadge(
      "agent",
      true,
      softRedRow("aborted", 1),
      NOW,
      "live",
    );
    expect(b.tone).toBe("amber");
    expect(b.label).toBe("~");
  });

  it("(a'') a SOFT first failure with fail_count=0 (legacy/edge) is also tolerated (<= 1)", () => {
    // fail_count is 1 on the first green→red tick, but guard the boundary: a
    // legacy/edge row reporting 0 must still be treated as a single soft miss.
    const b = buildStarterBadge(
      "agent",
      true,
      softRedRow("transport-error", 0),
      NOW,
      "live",
    );
    expect(b.tone).toBe("amber");
    expect(b.label).toBe("~");
  });

  it("(b) TWO consecutive SOFT misses (fail_count=2) FLIP to red ✗", () => {
    const b = buildStarterBadge(
      "agent",
      true,
      softRedRow("transport-error", 2),
      NOW,
      "live",
    );
    expect(b.tone).toBe("red");
    expect(b.label).toBe("✗");
  });

  it("(b') three+ consecutive SOFT misses (fail_count=3) stay red ✗", () => {
    const b = buildStarterBadge(
      "agent",
      true,
      softRedRow("aborted", 3),
      NOW,
      "live",
    );
    expect(b.tone).toBe("red");
    expect(b.label).toBe("✗");
  });

  it("(c) a HARD smoke-failed miss FLIPS immediately (fail_count=1, no tolerance)", () => {
    const hard = row("starter:agno/agent", "starter", "red", {
      signal: { errorClass: "smoke-failed" },
      fail_count: 1,
      first_failure_at: FRESH_OBSERVED_AT,
    });
    const b = buildStarterBadge("agent", true, hard, NOW, "live");
    expect(b.tone).toBe("red");
    expect(b.label).toBe("✗");
  });

  it("(d) a SOFT miss followed by a GREEN tick renders green (producer reset fail_count→0)", () => {
    // After recovery the producer rewrites state→green and fail_count→0. The
    // dashboard reads the recovered row directly; the soft-miss counter is
    // gone, so the cell renders a clean green ✓. (No dashboard-side counter to
    // reset — the producer owns the consecutive-failure count.)
    const recovered = row("starter:agno/agent", "starter", "green", {
      signal: {},
      fail_count: 0,
      first_failure_at: null,
    });
    const b = buildStarterBadge("agent", true, recovered, NOW, "live");
    expect(b.tone).toBe("green");
    expect(b.label).toBe("✓");
  });

  it("a red row with NO errorClass flips immediately (tolerance only softens EXPLICIT soft classes)", () => {
    // Conservative: we only soften when the producer explicitly tags the
    // failure transient. An untagged red is treated as a hard fail (preserves
    // the pre-existing red-row behaviour).
    const untagged = row("starter:agno/agent", "starter", "red", {
      signal: {},
      fail_count: 1,
    });
    const b = buildStarterBadge("agent", true, untagged, NOW, "live");
    expect(b.tone).toBe("red");
    expect(b.label).toBe("✗");
  });

  it("tolerance never applies to an UNSUPPORTED column (🚫 wins over soft red)", () => {
    const b = buildStarterBadge(
      "agent",
      false,
      softRedRow("transport-error", 1),
      NOW,
      "live",
    );
    expect(b.label).toBe("🚫");
    expect(b.tone).not.toBe("red");
    expect(b.tone).not.toBe("amber");
  });
});

describe("starter rows are informational — excluded from resolveCell rollup", () => {
  it("a red starter row does NOT make the feature-cell rollup red", () => {
    // resolveCell only reads health + e2e (+ informational badges). A starter
    // row sharing the slug must never leak into the rollup.
    const live = mapOf([
      row("health:agno", "health", "green"),
      row("e2e:agno/agentic-chat", "e2e", "green"),
      // A red starter row for the same integration:
      row("starter:agno/health", "starter", "red"),
      row("starter:agno/chat", "starter", "red"),
    ]);
    const cell = resolveCell(live, "agno", "agentic-chat", { now: NOW });
    // Rollup stays green (or whatever health+e2e dictate) — NOT red.
    expect(cell.rollup).not.toBe("red");
    // And the CellState shape exposes no starter contributor.
    expect(Object.keys(cell)).not.toContain("starter");
  });
});

describe("STATUS_LIST_FIELDS (initial-fetch projection allow-list)", () => {
  // Exhaustive `keyof StatusRow` map. The compiler requires EVERY StatusRow
  // field to appear as a key here (Record<keyof StatusRow, true>), so adding a
  // field to StatusRow forces a conscious update of this map — and therefore a
  // conscious decision about whether the new field belongs in the lightweight
  // initial projection. The runtime test below derives the expected set from
  // this map (all keys minus `signal`) and asserts STATUS_LIST_FIELDS matches.
  const STATUS_ROW_KEYS: Record<keyof StatusRow, true> = {
    id: true,
    key: true,
    dimension: true,
    state: true,
    signal: true,
    observed_at: true,
    transitioned_at: true,
    fail_count: true,
    first_failure_at: true,
  };

  it("equals every StatusRow field except `signal`", () => {
    const expected = new Set(
      Object.keys(STATUS_ROW_KEYS).filter((k) => k !== "signal"),
    );
    const actual = new Set(STATUS_LIST_FIELDS.split(","));
    expect(actual).toEqual(expected);
    // `signal` is the heavy field deliberately dropped from the initial fetch.
    expect(actual.has("signal")).toBe(false);
  });
});
