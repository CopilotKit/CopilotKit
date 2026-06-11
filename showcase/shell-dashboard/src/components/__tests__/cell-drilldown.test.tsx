/**
 * Unit tests for CellDrilldown — per-cell dimension detail panel.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { CellDrilldown } from "../cell-drilldown";
import { buildCellModel } from "@/lib/cell-model";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

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
  it("renders all 7 badge dimensions", () => {
    const live = mapOf([
      row("health:lgp", "health", "green", { ...FRESH }),
      row("e2e:lgp/agentic-chat", "e2e", "green", { ...FRESH }),
      row("smoke:lgp", "smoke", "green", { ...FRESH }),
      row("agent:lgp", "agent", "green", { ...FRESH }),
      row("chat:lgp", "chat", "green", { ...FRESH }),
      row("tools:lgp", "tools", "green", { ...FRESH }),
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
    expect(getByTestId("cell-drilldown")).toBeDefined();
    expect(getByText("Parity (Reference)")).toBeDefined();
    expect(getByText("CV (Conversation)")).toBeDefined();
    // `RT (Round Trip)` is now the D4 (chat+tools round-trip) row …
    expect(getByText("RT (Round Trip)")).toBeDefined();
    // … and the e2e row carries the de-crossed `E2E (Demo)` label.
    expect(getByText("E2E (Demo)")).toBeDefined();
    expect(getByText("API (Agent)")).toBeDefined();
    expect(getByText("Health")).toBeDefined();
    expect(getByText("Smoke")).toBeDefined();
  });

  it("renders a red RT (Round Trip) row for a red D4 fold while the service line stays green (headline drilldown-parity bug)", () => {
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
    // The d4 row owns the `RT (Round Trip)` label (and so its derived testid).
    const rtBadge = getByTestId("drilldown-badge-rt--round-trip-");
    expect(rtBadge.textContent).toContain("RT (Round Trip)");
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

  it("renders strikethrough n/a on the RT (Round Trip) row when chat/tools rows are absent", () => {
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
    const rtBadge = getByTestId("drilldown-badge-rt--round-trip-");
    expect(rtBadge.textContent).toContain("RT (Round Trip)");
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

  it("de-crosses the e2e label: E2E (Demo) renders and exactly ONE row is labelled RT (Round Trip)", () => {
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
    expect(getByText("E2E (Demo)")).toBeDefined();
    expect(getAllByText("RT (Round Trip)").length).toBe(1);
  });

  it("shows fail count and extracted Error field on a red RT (Round Trip) / D4 row", () => {
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
    const rtBadge = getByTestId("drilldown-badge-rt--round-trip-");
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
