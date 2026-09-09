/**
 * Unit tests for ParityMatrix — renders parity grid with reference column.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { ParityMatrix } from "../parity-matrix";
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

// Fresh timestamp so green rows are not tripped by the D1/D2/D4 staleness
// downgrade (deriveDepth defaults `now` to Date.now()). These tests assert
// achieved depth, not staleness, so the rows must read as recently observed.
const FRESH_OBSERVED_AT = new Date().toISOString();

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
    observed_at: FRESH_OBSERVED_AT,
    transitioned_at: FRESH_OBSERVED_AT,
    fail_count: 0,
    first_failure_at: null,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

const categories: FeatureCategory[] = [{ id: "chat-ui", name: "Chat & UI" }];

const integrations = [
  { slug: "lgp", name: "LangGraph Python", tier: "reference" as const },
  { slug: "crewai", name: "CrewAI", tier: "partial" as const },
];

const features = [
  { id: "agentic-chat", name: "Agentic Chat", category: "chat-ui" },
];

const cells: CatalogCell[] = [
  {
    id: "lgp/agentic-chat",
    manifestation: "integrated",
    integration: "lgp",
    integration_name: "LangGraph Python",
    feature: "agentic-chat",
    feature_name: "Agentic Chat",
    status: "wired",
    parity_tier: "reference",
    max_depth: 0,
    category: "chat-ui",
    category_name: "Chat & UI",
  },
  {
    id: "crewai/agentic-chat",
    manifestation: "integrated",
    integration: "crewai",
    integration_name: "CrewAI",
    feature: "agentic-chat",
    feature_name: "Agentic Chat",
    status: "wired",
    parity_tier: "partial",
    max_depth: 0,
    category: "chat-ui",
    category_name: "Chat & UI",
  },
];

describe("ParityMatrix", () => {
  it("renders with reference column first (Ref Depth label)", () => {
    const { getByText } = render(
      <ParityMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui"])}
        referenceSlug="lgp"
      />,
    );
    expect(getByText("Ref Depth")).toBeDefined();
  });

  it("renders integration headers", () => {
    const { getAllByTestId } = render(
      <ParityMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui"])}
        referenceSlug="lgp"
      />,
    );
    // Reference (lgp) renders as the frozen "Ref Depth" column (no
    // integration-header-* testid). Only crewai (non-ref) gets a
    // per-integration header — so headers.length === 1.
    const headers = getAllByTestId(/^integration-header-/);
    expect(headers.length).toBe(1);
    expect(headers[0].getAttribute("data-testid")).toBe(
      "integration-header-crewai",
    );
  });

  it("renders depth chips for cells", () => {
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
      row("health:crewai", "health", "green"),
    ]);
    const { getAllByTestId } = render(
      <ParityMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={live}
        defaultOpenCategories={new Set(["chat-ui"])}
        referenceSlug="lgp"
      />,
    );
    const depthChips = getAllByTestId("depth-chip");
    // 1 feature × (ref col + 1 non-ref col) = exactly 2 chips
    expect(depthChips.length).toBe(2);
  });

  it("reference column shows correct depth for reference integration", () => {
    const live = mapOf([
      row("health:lgp", "health", "green"),
      row("agent:lgp", "agent", "green"),
    ]);
    const { getAllByTestId } = render(
      <ParityMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={live}
        defaultOpenCategories={new Set(["chat-ui"])}
        referenceSlug="lgp"
      />,
    );
    const depthChips = getAllByTestId("depth-chip");
    // First chip should be reference column = lgp with D2
    expect(depthChips[0].textContent).toBe("D2");
  });

  it("orders non-reference integration headers strictly by parity tier", () => {
    // One integration per tier — alphabetical within tier (deterministic).
    // Reference (lgp) is rendered as the frozen Ref-Depth column and does
    // NOT appear in the integration-header-* set.
    const tierIntegrations = [
      { slug: "lgp", name: "LangGraph Python", tier: "reference" as const },
      { slug: "lgjs", name: "LangGraph JS", tier: "at_parity" as const },
      { slug: "crewai", name: "CrewAI", tier: "partial" as const },
      { slug: "mastra", name: "Mastra", tier: "minimal" as const },
      { slug: "noop", name: "Noop", tier: "not_wired" as const },
    ];
    const tierCells: CatalogCell[] = tierIntegrations.map((i) => ({
      id: `${i.slug}/agentic-chat`,
      manifestation: "integrated",
      integration: i.slug,
      integration_name: i.name,
      feature: "agentic-chat",
      feature_name: "Agentic Chat",
      status: "wired",
      parity_tier: i.tier,
      max_depth: 0,
      category: "chat-ui",
      category_name: "Chat & UI",
    }));

    const { getAllByTestId } = render(
      <ParityMatrix
        cells={tierCells}
        categories={categories}
        features={features}
        integrations={tierIntegrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui"])}
        referenceSlug="lgp"
      />,
    );
    const headers = getAllByTestId(/^integration-header-/);
    // Reference (lgp) is excluded from this list — it owns the Ref Depth col.
    const slugs = headers.map((h) =>
      h.getAttribute("data-testid")?.replace(/^integration-header-/, ""),
    );
    expect(slugs).toEqual(["lgjs", "crewai", "mastra", "noop"]);
  });

  it("skips starter cells (feature===null) without polluting the cell index", () => {
    // A starter cell (feature: null) must not be indexed under "<slug>/null"
    // — it should be silently skipped from the parity grid (which is
    // feature-row driven anyway).
    const cellsWithStarter: CatalogCell[] = [
      ...cells,
      {
        id: "lgp/__starter",
        manifestation: "starter",
        integration: "lgp",
        integration_name: "LangGraph Python",
        feature: null,
        feature_name: null,
        status: "wired",
        parity_tier: "not_wired",
        max_depth: 0,
        category: null,
        category_name: null,
      },
    ];
    const { getAllByTestId, queryByText } = render(
      <ParityMatrix
        cells={cellsWithStarter}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui"])}
        referenceSlug="lgp"
      />,
    );
    // 1 feature × (ref col + 1 non-ref col) = exactly 2 chips. The starter
    // cell adds no row, no chip.
    expect(getAllByTestId("depth-chip").length).toBe(2);
    expect(queryByText(/\bnull\b/)).toBeNull();
  });
});
