/**
 * Unit tests for CellDrilldown — per-cell dimension detail panel.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CellDrilldown } from "../cell-drilldown";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

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
  it("renders all 5 badge dimensions", () => {
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
      row("smoke:lgp", "smoke", "green"),
      row("agent:lgp", "agent", "green"),
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
    expect(getByText("API (Agent)")).toBeDefined();
    expect(getByText("Health")).toBeDefined();
    expect(getByText("RT (Round Trip)")).toBeDefined();
    expect(getByText("Smoke")).toBeDefined();
    expect(getByText("CV (Conversation)")).toBeDefined();
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
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("e2e:lgp/agentic-chat", "e2e", "green"),
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
