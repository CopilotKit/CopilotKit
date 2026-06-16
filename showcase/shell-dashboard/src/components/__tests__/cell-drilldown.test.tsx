/**
 * Unit tests for CellDrilldown — per-cell dimension detail panel.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { CellDrilldown, familyStalenessAnnotation } from "../cell-drilldown";
import { buildCellModel } from "@/lib/cell-model";
import type { BadgeRender, LiveStatusMap, StatusRow } from "@/lib/live-status";
import { WorkerRunsProvider } from "@/lib/worker-runs-context";
import type { WorkerRunsStatus } from "@/hooks/use-worker-runs";
import type { WorkerFamilySummary, WorkerRunBatch } from "@/lib/ops-api";

// The `row()` helper's hardcoded 2026-04-20 timestamps are STALE against the
// health (45m) / e2e (6h) / d4 (1h) windows, and CellDrilldown calls
// resolveCell with NO `now` (real Date.now() applies). Tests that need rows
// to resolve FRESH must override observed_at/transitioned_at with this.
const FRESH_OBSERVED_AT = new Date().toISOString();
const FRESH = {
  observed_at: FRESH_OBSERVED_AT,
  transitioned_at: FRESH_OBSERVED_AT,
} as const;

function row(
  key: string,
  dimension: string,
  state: StatusRow["state"],
  overrides?: Partial<StatusRow>,
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
    ...overrides,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

describe("CellDrilldown", () => {
  it("renders all 6 badge dimensions (smoke dropped — redundant w/ health)", () => {
    const live = mapOf([
      row("health:lgp", "health", "green", { ...FRESH }),
      row("e2e:lgp/agentic-chat", "e2e", "green", { ...FRESH }),
      row("agent:lgp", "agent", "green", { ...FRESH }),
      row("chat:lgp", "chat", "green", { ...FRESH }),
      row("tools:lgp", "tools", "green", { ...FRESH }),
    ]);
    const { getByTestId, getByText, queryByText } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    expect(getByTestId("cell-drilldown")).toBeDefined();
    expect(getByText("Parity (Reference)")).toBeDefined();
    expect(getByText("1P (Single Pill)")).toBeDefined();
    // `BE (Agent)` is now the D4 (chat+tools round-trip) row …
    expect(getByText("BE (Agent)")).toBeDefined();
    // … and the e2e row carries the renamed `UI (Frontend)` label
    // (was `E2E (Demo)` — taxonomy cleanup).
    expect(getByText("UI (Frontend)")).toBeDefined();
    expect(getByText("API (HTTP)")).toBeDefined();
    expect(getByText("Health")).toBeDefined();
    // The "Smoke" row was dropped: the /smoke endpoint had the same contract
    // as /health on the same service (pure redundancy) and is no longer
    // probed or rendered.
    expect(queryByText("Smoke")).toBeNull();
  });

  it("renders a red BE (Agent) row for a red D4 fold while the service line stays green (headline drilldown-parity bug)", () => {
    // The dimension that turns the pill red (D4: red tools round-trip) must
    // be VISIBLE in the popup. Pre-fix the popup had no D4 row at all, so a
    // pill-red cell showed nothing non-green to explain itself.
    const live = mapOf([
      row("health:lgp", "health", "green", { ...FRESH }),
      row("e2e:lgp/agentic-chat", "e2e", "green", { ...FRESH }),
      row("chat:lgp", "chat", "green", { ...FRESH }),
      row("tools:lgp", "tools", "red", { ...FRESH }),
    ]);
    const { getByTestId, getByText } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    // The d4 row owns the `BE (Agent)` label (and so its derived testid).
    const rtBadge = getByTestId("drilldown-badge-be--agent-");
    expect(rtBadge.textContent).toContain("BE (Agent)");
    expect(rtBadge.textContent).toContain("✗");
    // The service-scoped line (health + e2e) is still green — honest scope.
    expect(getByText("green")).toBeDefined();
    // Cross-resolver pin: the SAME map makes the pill red via buildCellModel's
    // D1-D4 gate — so a pill-red cause now always has a visible non-green row.
    expect(
      buildCellModel(live, {
        slug: "lgp",
        featureId: "agentic-chat",
        isSupported: true,
        isWired: true,
      }).chipColor,
    ).toBe("red");
  });

  it("renders strikethrough n/a on the BE (Agent) row when chat/tools rows are absent", () => {
    const live = mapOf([
      row("health:lgp", "health", "green", { ...FRESH }),
      row("e2e:lgp/agentic-chat", "e2e", "green", { ...FRESH }),
    ]);
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    const rtBadge = getByTestId("drilldown-badge-be--agent-");
    expect(rtBadge.textContent).toContain("BE (Agent)");
    expect(rtBadge.textContent).toContain("n/a");
    expect(rtBadge.querySelector(".line-through")).not.toBeNull();
  });

  it("labels the rollup line with its honest scope — Service (health + e2e), not Rollup", () => {
    const { getByText, queryByText } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={new Map()}
        onClose={() => {}}
      />,
    );
    expect(getByText("Service (health + e2e)")).toBeDefined();
    expect(queryByText("Rollup")).toBeNull();
  });

  it("renames the e2e label to UI (Frontend); exactly ONE row is labelled BE (Agent)", () => {
    const live = mapOf([
      row("e2e:lgp/agentic-chat", "e2e", "green", { ...FRESH }),
      row("chat:lgp", "chat", "green", { ...FRESH }),
      row("tools:lgp", "tools", "green", { ...FRESH }),
    ]);
    const { getByText, getAllByText } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    // E2E (Demo) was renamed to UI (Frontend); the underlying `e2e:<slug>/<feature>`
    // probe key is preserved on PocketBase for backward compatibility.
    expect(getByText("UI (Frontend)")).toBeDefined();
    expect(getAllByText("BE (Agent)").length).toBe(1);
  });

  it("shows fail count and extracted Error field on a red BE (Agent) / D4 row", () => {
    const live = mapOf([
      row("chat:lgp", "chat", "green", { ...FRESH }),
      row("tools:lgp", "tools", "red", {
        ...FRESH,
        fail_count: 3,
        first_failure_at: "2026-04-19T10:00:00Z",
        signal: { error: "boom" },
      }),
    ]);
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    const rtBadge = getByTestId("drilldown-badge-be--agent-");
    expect(within(rtBadge).getByTestId("fail-count").textContent).toBe("3");
    expect(within(rtBadge).getByTestId("signal-field-error").textContent).toBe(
      "boom",
    );
  });

  it("shows integration and feature name in header", () => {
    const { getByText } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={new Map()}
        onClose={() => {}}
      />,
    );
    expect(getByText("LangGraph Python")).toBeDefined();
    expect(getByText("Agentic Chat")).toBeDefined();
  });

  it("shows rollup tone", () => {
    const live = mapOf([
      row("health:lgp", "health", "red", {
        fail_count: 5,
        first_failure_at: "2026-04-19T10:00:00Z",
        signal: { error: "connection timeout" },
      }),
    ]);
    const { getByText } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    // Rollup should display "red"
    expect(getByText("red")).toBeDefined();
  });

  it("shows fail_count and first_failure_at for red badges", () => {
    const live = mapOf([
      row("health:lgp", "health", "red", {
        fail_count: 5,
        first_failure_at: "2026-04-19T10:00:00Z",
        signal: { error: "connection timeout" },
      }),
    ]);
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    const healthBadge = getByTestId("drilldown-badge-health");
    expect(healthBadge.textContent).toContain("5");
    expect(healthBadge.textContent).toContain("Apr");
  });

  it("extracts signal fields as readable text for red badges", () => {
    const live = mapOf([
      row("e2e:lgp/agentic-chat", "e2e", "red", {
        fail_count: 2,
        first_failure_at: "2026-04-18T12:00:00Z",
        signal: {
          errorDesc: "Agent returned empty response",
          backendUrl: "https://lgp.example.com",
          apiRequestCount: 3,
        },
      }),
    ]);
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    // Extracted fields should be visible without expanding raw signal
    expect(getByTestId("signal-field-error").textContent).toBe(
      "Agent returned empty response",
    );
    expect(getByTestId("signal-field-backend-url").textContent).toBe(
      "https://lgp.example.com",
    );
    expect(getByTestId("signal-field-api-requests").textContent).toBe("3");
  });

  it("shows raw signal payload behind collapsible toggle", () => {
    const live = mapOf([
      row("e2e:lgp/agentic-chat", "e2e", "red", {
        fail_count: 2,
        first_failure_at: "2026-04-18T12:00:00Z",
        signal: { error: "assertion failed", step: "login" },
      }),
    ]);
    const { getByTestId, queryByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    // Raw signal should be collapsed by default
    expect(queryByTestId("signal-payload")).toBeNull();
    // Click the toggle to expand
    fireEvent.click(getByTestId("signal-toggle"));
    const signalEl = getByTestId("signal-payload");
    expect(signalEl.textContent).toContain("assertion failed");
    expect(signalEl.textContent).toContain("login");
  });

  it("does not show failure details for green badges", () => {
    // FRESH is required: without it these rows resolve amber-stale (see header
    // invariant) and the "green badges" premise silently breaks.
    const live = mapOf([
      row("health:lgp", "health", "green", { ...FRESH }),
      row("e2e:lgp/agentic-chat", "e2e", "green", { ...FRESH }),
    ]);
    const { queryAllByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    expect(queryAllByTestId("fail-count").length).toBe(0);
    expect(queryAllByTestId("signal-payload").length).toBe(0);
  });

  it("calls onClose when close button is clicked", () => {
    let closed = false;
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={new Map()}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    fireEvent.click(getByTestId("drilldown-close"));
    expect(closed).toBe(true);
  });

  it("renders strikethrough 'n/a' for dimensions with no data (not '?')", () => {
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={new Map()}
        onClose={() => {}}
      />,
    );
    const healthBadge = getByTestId("drilldown-badge-health");
    expect(healthBadge.textContent).toContain("n/a");
    // Verify strikethrough styling is applied
    const strikethroughEl = healthBadge.querySelector(".line-through");
    expect(strikethroughEl).not.toBeNull();
  });

  it("deduplicates errorDesc and error (only shows first match)", () => {
    const live = mapOf([
      row("e2e:lgp/agentic-chat", "e2e", "red", {
        fail_count: 1,
        signal: {
          errorDesc: "Agent timed out",
          error: "timeout",
        },
      }),
    ]);
    const { getByTestId, queryAllByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );
    // errorDesc wins — only one "Error:" line
    expect(getByTestId("signal-field-error").textContent).toBe(
      "Agent timed out",
    );
    // Should not have a second error field
    expect(queryAllByTestId("signal-field-error").length).toBe(1);
  });

  it("uses wider dialog (480px)", () => {
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={new Map()}
        onClose={() => {}}
      />,
    );
    const dialog = getByTestId("cell-drilldown");
    expect(dialog.className).toContain("w-[480px]");
    expect(dialog.className).not.toContain("w-72");
  });
});

/* ------------------------------------------------------------------ */
/*  §7.2 family staleness annotation                                   */
/* ------------------------------------------------------------------ */

function makeBatch(overrides: Partial<WorkerRunBatch> = {}): WorkerRunBatch {
  return {
    runId: "r1",
    triggered: false,
    enqueuedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    finishedAt: new Date(Date.now() - 80 * 60_000).toISOString(),
    durationMs: 600_000,
    outcome: "failed",
    jobs: { total: 1, done: 0, failed: 1, reclaimed: 0 },
    cells: null,
    redsIntroduced: null,
    redsCleared: null,
    errorSummary: null,
    commErrorKinds: [],
    ...overrides,
  };
}

function makeFamily(
  overrides: Partial<WorkerFamilySummary> = {},
): WorkerFamilySummary {
  return {
    family: "d6",
    label: "D6 all-pills",
    probeKeyPrefix: "d6",
    schedule: "40 * * * *",
    periodMs: 3_600_000,
    nextRunAt: null,
    lastRun: makeBatch(),
    inflight: null,
    lastSuccessAt: new Date(Date.now() - 8 * 3_600_000).toISOString(),
    ...overrides,
  };
}

function okWorkerRuns(families: WorkerFamilySummary[]): WorkerRunsStatus {
  return {
    status: "ok",
    data: { families, workers: [] },
    fetchedAt: Date.now(),
  };
}

describe("CellDrilldown §7.2 family annotation", () => {
  it("appends 'Family last succeeded <relative> · last attempt <relative> (<outcome>)' for a stale-degraded row whose key prefix maps via payload probeKeyPrefix", () => {
    // A green d6 row observed 7 h ago: past the 6 h E2E window, so the
    // cell's EXISTING stale check downgrades it to amber/degraded with
    // fail_count 0 — the exact shape §7.2 annotates.
    const old = new Date(Date.now() - 7 * 3_600_000).toISOString();
    const live = mapOf([
      row("d6:lgp/agentic-chat", "d6", "green", {
        observed_at: old,
        transitioned_at: old,
      }),
    ]);
    const { getByTestId } = render(
      <WorkerRunsProvider value={okWorkerRuns([makeFamily()])}>
        <CellDrilldown
          slug="lgp"
          featureId="agentic-chat"
          integrationName="LangGraph Python"
          featureName="Agentic Chat"
          liveStatus={live}
          onClose={() => {}}
        />
      </WorkerRunsProvider>,
    );
    const annotation = getByTestId("family-annotation");
    expect(annotation.textContent).toMatch(
      /^Family last succeeded .+ · last attempt .+ \(failed\)$/,
    );
  });

  it("does NOT annotate a genuine failure (fresh red row) even when its family maps", () => {
    const live = mapOf([
      row("d6:lgp/agentic-chat", "d6", "red", {
        fail_count: 3,
        first_failure_at: "2026-06-10T00:00:00Z",
        observed_at: new Date().toISOString(),
        transitioned_at: new Date().toISOString(),
      }),
    ]);
    const { queryAllByTestId } = render(
      <WorkerRunsProvider value={okWorkerRuns([makeFamily()])}>
        <CellDrilldown
          slug="lgp"
          featureId="agentic-chat"
          integrationName="LangGraph Python"
          featureName="Agentic Chat"
          liveStatus={live}
          onClose={() => {}}
        />
      </WorkerRunsProvider>,
    );
    expect(queryAllByTestId("family-annotation").length).toBe(0);
  });

  it("d4 rows annotate under their own 1h gate — the annotation piggybacks the cell's existing stale verdict and applies NO threshold of its own", () => {
    const now = Date.now();
    // A d4/e2e-smoke row already downgraded by ITS OWN gate
    // (D4_STALE_AFTER_MS, 1 h — applied upstream by the cell model):
    // amber/degraded, fail_count 0.
    const observed = new Date(now - 65 * 60_000).toISOString();
    const d4Row: StatusRow = {
      id: "d4-1",
      key: "d4:lgp",
      dimension: "d4",
      state: "degraded",
      signal: null,
      observed_at: observed,
      transitioned_at: observed,
      fail_count: 0,
      first_failure_at: null,
    };
    const badge: BadgeRender = {
      tone: "amber",
      label: "~",
      tooltip: "",
      row: d4Row,
    };
    // e2e-smoke family (probeKeyPrefix "d4", 15 min period) that is NOT
    // 2-period silent (last success 20 min ago < 30 min): the annotation
    // must STILL append, because the only gate is the cell's own existing
    // stale verdict — §7.2 "it never substitutes a different threshold".
    const smoke = makeFamily({
      family: "e2e-smoke",
      label: "E2E smoke",
      probeKeyPrefix: "d4",
      schedule: "*/15 * * * *",
      periodMs: 900_000,
      lastSuccessAt: new Date(now - 20 * 60_000).toISOString(),
      lastRun: makeBatch({
        outcome: "completed",
        enqueuedAt: new Date(now - 25 * 60_000).toISOString(),
        finishedAt: new Date(now - 20 * 60_000).toISOString(),
      }),
    });
    const annotation = familyStalenessAnnotation(badge, [smoke], now);
    expect(annotation).toMatch(
      /^Family last succeeded .+ · last attempt .+ \(completed\)$/,
    );
    // A FRESH (non-degraded) d4 row never annotates, even when the family
    // IS silent — the cell's own verdict governs.
    const freshBadge: BadgeRender = {
      tone: "green",
      label: "✓",
      tooltip: "",
      row: { ...d4Row, state: "green" },
    };
    const silentSmoke = makeFamily({
      ...smoke,
      lastSuccessAt: new Date(now - 3 * 3_600_000).toISOString(),
    });
    expect(familyStalenessAnnotation(freshBadge, [silentSmoke], now)).toBe(
      null,
    );
  });

  it("annotation uses the inflight batch as last attempt when one exists (stalled rendered verbatim)", () => {
    const now = Date.now();
    const badge: BadgeRender = {
      tone: "amber",
      label: "~",
      tooltip: "",
      row: {
        id: "d6-1",
        key: "d6:lgp/agentic-chat",
        dimension: "d6",
        state: "degraded",
        signal: null,
        observed_at: new Date(now - 7 * 3_600_000).toISOString(),
        transitioned_at: new Date(now - 7 * 3_600_000).toISOString(),
        fail_count: 0,
        first_failure_at: null,
      },
    };
    const family = makeFamily({
      inflight: {
        runId: "r2",
        triggered: false,
        enqueuedAt: new Date(now - 2 * 3_600_000).toISOString(),
        elapsedMs: 2 * 3_600_000,
        stalled: true,
        jobs: { pending: 1, claimed: 0, running: 0, done: 0, failed: 0 },
      },
    });
    expect(familyStalenessAnnotation(badge, [family], now)).toMatch(
      /· last attempt .+ \(stalled\)$/,
    );
  });

  it("returns null for a zero-batch family and for an unmapped key prefix", () => {
    const now = Date.now();
    const badge: BadgeRender = {
      tone: "amber",
      label: "~",
      tooltip: "",
      row: {
        id: "d6-2",
        key: "d6:lgp/agentic-chat",
        dimension: "d6",
        state: "degraded",
        signal: null,
        observed_at: new Date(now - 7 * 3_600_000).toISOString(),
        transitioned_at: new Date(now - 7 * 3_600_000).toISOString(),
        fail_count: 0,
        first_failure_at: null,
      },
    };
    const zeroBatch = makeFamily({
      lastRun: null,
      inflight: null,
      lastSuccessAt: null,
    });
    expect(familyStalenessAnnotation(badge, [zeroBatch], now)).toBe(null);
    const unmapped = makeFamily({ probeKeyPrefix: "d5-single-pill-e2e" });
    expect(familyStalenessAnnotation(badge, [unmapped], now)).toBe(null);
  });
});
