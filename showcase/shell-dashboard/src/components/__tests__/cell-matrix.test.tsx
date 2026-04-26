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

  it("renders empty-state when filter=regressions (not yet implemented)", () => {
    const { getByTestId, getByText } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="regressions"
        referenceSlug="lgp"
      />,
    );
    const root = getByTestId("cell-matrix");
    expect(root.getAttribute("data-empty-reason")).toBe(
      "regressions-not-implemented",
    );
    expect(
      getByText(/Regression detection not yet implemented/i),
    ).toBeDefined();
  });

  it("skips starter cells (feature===null) without orphaning the cell index", () => {
    // A starter cell has `feature: null`. It should be safely ignored by the
    // matrix (no row to render) and must not pollute the cell-index with
    // "<slug>/null" keys.
    const starterCell: CatalogCell = {
      id: "lgp/__starter",
      integration: "lgp",
      integration_name: "LangGraph Python",
      feature: null,
      feature_name: null,
      status: "wired",
      category: null,
      category_name: null,
    };
    const { getAllByTestId, queryByText } = render(
      <CellMatrix
        cells={[...cells, starterCell]}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="all"
        referenceSlug="lgp"
      />,
    );
    // Only the 4 (feature × integration) chips render — the starter cell
    // does not produce an additional chip and does not collide with any
    // existing key.
    const depthChips = getAllByTestId("depth-chip");
    expect(depthChips.length).toBe(4);
    // No spurious "null" leak in the rendered output
    expect(queryByText(/\bnull\b/)).toBeNull();
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
});
