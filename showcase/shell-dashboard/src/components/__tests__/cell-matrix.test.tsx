/**
 * Unit tests for CellMatrix — renders cells grouped by category,
 * collapse/expand, integration column ordering by parity tier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CellMatrix } from "../cell-matrix";
import type { CatalogCell } from "../depth-utils";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";
import type { FeatureCategory } from "@/lib/registry";

// Mock localStorage
const storageMap = new Map<string, string>();
beforeEach(() => {
  storageMap.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    get length() {
      return storageMap.size;
    },
    key: () => null,
  });
});

afterEach(() => {
  // Clear vi.stubGlobal so the localStorage stub doesn't leak across tests
  // running in the same vitest worker.
  vi.unstubAllGlobals();
});

function row(
  key: string,
  dimension: string,
  state: StatusRow["state"],
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
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

const categories: FeatureCategory[] = [
  { id: "chat-ui", name: "Chat & UI" },
  { id: "platform", name: "Platform" },
];

interface IntegrationInfo {
  slug: string;
  name: string;
  tier: "reference" | "at_parity" | "partial" | "minimal" | "not_wired";
}

const integrations: IntegrationInfo[] = [
  { slug: "lgp", name: "LangGraph Python", tier: "reference" },
  { slug: "crewai", name: "CrewAI", tier: "partial" },
];

const features = [
  { id: "agentic-chat", name: "Agentic Chat", category: "chat-ui" },
  { id: "auth", name: "Authentication", category: "platform" },
];

const cells: CatalogCell[] = [
  {
    id: "lgp/agentic-chat",
    integration: "lgp",
    integration_name: "LangGraph Python",
    feature: "agentic-chat",
    feature_name: "Agentic Chat",
    status: "wired",
    max_depth: 0,
    category: "chat-ui",
    category_name: "Chat & UI",
  },
  {
    id: "crewai/agentic-chat",
    integration: "crewai",
    integration_name: "CrewAI",
    feature: "agentic-chat",
    feature_name: "Agentic Chat",
    status: "unshipped",
    max_depth: 0,
    category: "chat-ui",
    category_name: "Chat & UI",
  },
  {
    id: "lgp/auth",
    integration: "lgp",
    integration_name: "LangGraph Python",
    feature: "auth",
    feature_name: "Authentication",
    status: "wired",
    max_depth: 0,
    category: "platform",
    category_name: "Platform",
  },
  {
    id: "crewai/auth",
    integration: "crewai",
    integration_name: "CrewAI",
    feature: "auth",
    feature_name: "Authentication",
    status: "stub",
    max_depth: 0,
    category: "platform",
    category_name: "Platform",
  },
];

// Which categories should be open by default (derived from wired counts)
const defaultOpenCategories = new Set(["chat-ui"]);

describe("CellMatrix", () => {
  it("renders category headers", () => {
    const { getByText } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={defaultOpenCategories}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    expect(getByText("Chat & UI")).toBeDefined();
    expect(getByText("Platform")).toBeDefined();
  });

  it("renders integration column headers in parity-tier order", () => {
    const { getAllByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={defaultOpenCategories}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    const headers = getAllByTestId(/^integration-header-/);
    // reference (lgp) should come first
    expect(headers[0].getAttribute("data-testid")).toBe(
      "integration-header-lgp",
    );
    expect(headers[1].getAttribute("data-testid")).toBe(
      "integration-header-crewai",
    );
  });

  it("renders depth chips for cells", () => {
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const { getAllByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={live}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    const depthChips = getAllByTestId("depth-chip");
    // 2 features (agentic-chat, auth) × 2 integrations (lgp, crewai)
    // with both categories open ⇒ exactly 4 chips.
    expect(depthChips.length).toBe(4);
  });

  it("collapses and expands categories", () => {
    const { getAllByTestId, queryAllByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    const depthChipsBefore = queryAllByTestId("depth-chip").length;
    // baseline: 2 features × 2 integrations × 2 categories open = 4 chips
    expect(depthChipsBefore).toBe(4);
    const headers = getAllByTestId("collapsible-header");
    // Collapse first category
    fireEvent.click(headers[0]);
    const depthChipsCollapsed = queryAllByTestId("depth-chip").length;
    expect(depthChipsCollapsed).toBeLessThan(depthChipsBefore);
    // Re-expand: chip count must return to baseline (regression guard for
    // toggle state being one-way).
    fireEvent.click(headers[0]);
    const depthChipsAfter = queryAllByTestId("depth-chip").length;
    expect(depthChipsAfter).toBe(depthChipsBefore);
  });

  it("filters out feature rows where every integration is unshipped (filter=wired)", () => {
    // Add a third feature whose every cell is unshipped — under filter="wired"
    // this row must NOT render; under filter="all" it MUST render.
    const extendedCategories: FeatureCategory[] = [
      { id: "chat-ui", name: "Chat & UI" },
      { id: "platform", name: "Platform" },
      { id: "lab", name: "Lab" },
    ];
    const extendedFeatures = [
      ...features,
      { id: "voice", name: "Voice", category: "lab" },
    ];
    const extendedCells: CatalogCell[] = [
      ...cells,
      // Both integrations unshipped for "voice" — under filter="wired" this
      // row should be hidden; under filter="all" it should be visible.
      {
        id: "lgp/voice",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "voice",
        feature_name: "Voice",
        status: "unshipped",
        max_depth: 0,
        category: "lab",
        category_name: "Lab",
      },
      {
        id: "crewai/voice",
        integration: "crewai",
        integration_name: "CrewAI",
        feature: "voice",
        feature_name: "Voice",
        status: "unshipped",
        max_depth: 0,
        category: "lab",
        category_name: "Lab",
      },
    ];

    const renderWith = (filter: "all" | "wired") =>
      render(
        <CellMatrix
          cells={extendedCells}
          categories={extendedCategories}
          features={extendedFeatures}
          integrations={integrations}
          liveStatus={new Map()}
          defaultOpenCategories={new Set(["chat-ui", "platform", "lab"])}
          filter={filter}
          referenceSlug="lgp"
        />,
      );

    const all = renderWith("all");
    // Voice row IS visible under filter=all
    expect(all.queryByText("Voice")).not.toBeNull();
    all.unmount();

    const wired = renderWith("wired");
    // Voice row is hidden under filter=wired (every cell unshipped)
    expect(wired.queryByText("Voice")).toBeNull();
    // Other two feature rows still rendered
    expect(wired.queryByText("Agentic Chat")).not.toBeNull();
    expect(wired.queryByText("Authentication")).not.toBeNull();
  });

  it("filters to rows with regressions when filter=regressions", () => {
    // lgp/agentic-chat has D5 mapping → maxPossible=5, achieved=2 → regression
    // lgp/no-d5-feature has NO D5 mapping → maxPossible=4, achieved=4 → no regression
    const regressCells: CatalogCell[] = [
      {
        id: "lgp/agentic-chat",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "agentic-chat",
        feature_name: "Agentic Chat",
        status: "wired",
        max_depth: 3,
        category: "chat-ui",
        category_name: "Chat & UI",
      },
      {
        id: "lgp/no-d5-feature",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "no-d5-feature",
        feature_name: "No D5 Feature",
        status: "wired",
        max_depth: 0,
        category: "platform",
        category_name: "Platform",
      },
    ];
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("e2e:lgp/no-d5-feature", "e2e", "green"),
      row("chat:lgp", "chat", "green"),
    ]);
    const oneIntegration = [
      { slug: "lgp", name: "LangGraph Python", tier: "reference" as const },
    ];
    const { queryByText } = render(
      <CellMatrix
        cells={regressCells}
        categories={categories}
        features={features}
        integrations={oneIntegration}
        liveStatus={live}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="regressions"
        referenceSlug="lgp"
      />,
    );
    // agentic-chat has regression (achieved=2 < maxPossible=5) → visible
    expect(queryByText("Agentic Chat")).not.toBeNull();
    // no-d5-feature at ceiling (achieved=4 === maxPossible=4) → hidden
    expect(queryByText("No D5 Feature")).toBeNull();
  });

  it("filters to show only reference integration when filter=reference", () => {
    const { getAllByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="reference"
        referenceSlug="lgp"
      />,
    );
    // Should only show lgp columns
    const headers = getAllByTestId(/^integration-header-/);
    expect(headers.length).toBe(1);
    expect(headers[0].getAttribute("data-testid")).toBe(
      "integration-header-lgp",
    );
  });

  it("gaps filter includes rows where a cell has red probes (functional gap)", () => {
    // lgp/agentic-chat is wired with health=red → functional gap
    // lgp/auth is wired with health=green → not a gap
    const gapCells: CatalogCell[] = [
      {
        id: "lgp/agentic-chat",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "agentic-chat",
        feature_name: "Agentic Chat",
        status: "wired",
        max_depth: 0,
        category: "chat-ui",
        category_name: "Chat & UI",
      },
      {
        id: "lgp/auth",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "auth",
        feature_name: "Authentication",
        status: "wired",
        max_depth: 0,
        category: "platform",
        category_name: "Platform",
      },
    ];
    const live = mapOf([
      row("health:lgp", "health", "red"),
      row("e2e:lgp/agentic-chat", "e2e", "red"),
    ]);
    const oneIntegration = [
      { slug: "lgp", name: "LangGraph Python", tier: "reference" as const },
    ];
    const { queryByText } = render(
      <CellMatrix
        cells={gapCells}
        categories={categories}
        features={features}
        integrations={oneIntegration}
        liveStatus={live}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="gaps"
        referenceSlug="lgp"
      />,
    );
    // agentic-chat has red rollup → visible as functional gap
    expect(queryByText("Agentic Chat")).not.toBeNull();
    // auth also visible because health:lgp is red → rollup is red for it too
    expect(queryByText("Authentication")).not.toBeNull();
  });

  it("clicking a cell opens the drilldown panel", () => {
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const { getByTestId, queryByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={live}
        defaultOpenCategories={new Set(["chat-ui"])}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    // Initially no drilldown
    expect(queryByTestId("cell-drilldown")).toBeNull();
    // Click the lgp/agentic-chat cell button
    fireEvent.click(getByTestId("cell-btn-lgp-agentic-chat"));
    // Drilldown should now be visible
    expect(queryByTestId("cell-drilldown")).not.toBeNull();
  });

  it("renders unsupported cells with a distinct chip from unshipped", () => {
    // crewai/auth is unsupported (architectural limit), lgp/auth is wired,
    // crewai/agentic-chat is unshipped. The unsupported chip and unshipped
    // chip must render with different data-status attributes.
    const mixedCells: CatalogCell[] = [
      {
        id: "lgp/agentic-chat",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "agentic-chat",
        feature_name: "Agentic Chat",
        status: "wired",
        max_depth: 0,
        category: "chat-ui",
        category_name: "Chat & UI",
      },
      {
        id: "crewai/agentic-chat",
        integration: "crewai",
        integration_name: "CrewAI",
        feature: "agentic-chat",
        feature_name: "Agentic Chat",
        status: "unshipped",
        max_depth: 0,
        category: "chat-ui",
        category_name: "Chat & UI",
      },
      {
        id: "lgp/auth",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "auth",
        feature_name: "Authentication",
        status: "wired",
        max_depth: 0,
        category: "platform",
        category_name: "Platform",
      },
      {
        id: "crewai/auth",
        integration: "crewai",
        integration_name: "CrewAI",
        feature: "auth",
        feature_name: "Authentication",
        status: "unsupported",
        max_depth: 0,
        category: "platform",
        category_name: "Platform",
      },
    ];

    const { getAllByTestId } = render(
      <CellMatrix
        cells={mixedCells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    const chips = getAllByTestId("depth-chip");
    const statuses = chips.map((c) => c.getAttribute("data-status"));
    expect(statuses).toContain("unshipped");
    expect(statuses).toContain("unsupported");
  });

  it("gaps filter excludes rows where every cell is unsupported (architectural limit, not work)", () => {
    // crewai/voice is unsupported (framework can't do this), lgp/voice unsupported too.
    // Under gaps, this row must NOT show — it's not a gap because no work is expected.
    const extendedCategories: FeatureCategory[] = [
      { id: "chat-ui", name: "Chat & UI" },
      { id: "platform", name: "Platform" },
      { id: "lab", name: "Lab" },
    ];
    const extendedFeatures = [
      ...features,
      { id: "voice", name: "Voice", category: "lab" },
    ];
    const unsupportedCells: CatalogCell[] = [
      ...cells,
      {
        id: "lgp/voice",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: "voice",
        feature_name: "Voice",
        status: "unsupported",
        max_depth: 0,
        category: "lab",
        category_name: "Lab",
      },
      {
        id: "crewai/voice",
        integration: "crewai",
        integration_name: "CrewAI",
        feature: "voice",
        feature_name: "Voice",
        status: "unsupported",
        max_depth: 0,
        category: "lab",
        category_name: "Lab",
      },
    ];

    const { queryByText } = render(
      <CellMatrix
        cells={unsupportedCells}
        categories={extendedCategories}
        features={extendedFeatures}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform", "lab"])}
        filter="gaps"
        referenceSlug="lgp"
      />,
    );
    // Voice row must NOT be visible — every cell unsupported is not a gap.
    expect(queryByText("Voice")).toBeNull();
  });

  it("clicking the same cell again closes the drilldown", () => {
    const { getByTestId, queryByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui"])}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    fireEvent.click(getByTestId("cell-btn-lgp-agentic-chat"));
    expect(queryByTestId("cell-drilldown")).not.toBeNull();
    // Click same cell again to toggle off
    fireEvent.click(getByTestId("cell-btn-lgp-agentic-chat"));
    expect(queryByTestId("cell-drilldown")).toBeNull();
  });
});
