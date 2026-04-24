/**
 * Unit tests for CellMatrix — renders cells grouped by category,
 * collapse/expand, integration column ordering by parity tier.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
    get length() { return storageMap.size; },
    key: () => null,
  });
});

function row(key: string, dimension: string, state: StatusRow["state"]): StatusRow {
  return {
    id: `id-${key}`, key, dimension, state, signal: {},
    observed_at: "2026-04-20T00:00:00Z", transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0, first_failure_at: null,
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
  { id: "lgp/agentic-chat", integration: "lgp", feature: "agentic-chat", status: "wired", category: "chat-ui" },
  { id: "crewai/agentic-chat", integration: "crewai", feature: "agentic-chat", status: "unshipped", category: "chat-ui" },
  { id: "lgp/auth", integration: "lgp", feature: "auth", status: "wired", category: "platform" },
  { id: "crewai/auth", integration: "crewai", feature: "auth", status: "stub", category: "platform" },
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
    expect(headers[0].getAttribute("data-testid")).toBe("integration-header-lgp");
    expect(headers[1].getAttribute("data-testid")).toBe("integration-header-crewai");
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
    expect(depthChips.length).toBeGreaterThanOrEqual(2);
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
    // Collapse first category
    const headers = getAllByTestId("collapsible-header");
    fireEvent.click(headers[0]);
    const depthChipsAfter = queryAllByTestId("depth-chip").length;
    expect(depthChipsAfter).toBeLessThan(depthChipsBefore);
  });

  it("filters to show only rows with wired cells when filter=wired", () => {
    const { getAllByTestId } = render(
      <CellMatrix
        cells={cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={new Map()}
        defaultOpenCategories={new Set(["chat-ui", "platform"])}
        filter="wired"
        referenceSlug="lgp"
      />,
    );
    const depthChips = getAllByTestId("depth-chip");
    // Both rows have at least one wired cell (lgp is wired in both),
    // so both rows are visible. The row renders all integration columns
    // including unshipped/stub.
    expect(depthChips.length).toBeGreaterThan(0);
    // At least one chip should show a depth label (not "--")
    const texts = depthChips.map((el) => el.textContent);
    expect(texts.some((t) => t !== "--")).toBe(true);
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
    expect(headers[0].getAttribute("data-testid")).toBe("integration-header-lgp");
  });
});
