/**
 * Unit tests for ParityMatrix — renders parity grid with reference column.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
];

const integrations = [
  { slug: "lgp", name: "LangGraph Python", tier: "reference" as const },
  { slug: "crewai", name: "CrewAI", tier: "partial" as const },
];

const features = [
  { id: "agentic-chat", name: "Agentic Chat", category: "chat-ui" },
];

const cells: CatalogCell[] = [
  { id: "lgp/agentic-chat", integration: "lgp", feature: "agentic-chat", status: "wired", category: "chat-ui" },
  { id: "crewai/agentic-chat", integration: "crewai", feature: "agentic-chat", status: "wired", category: "chat-ui" },
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
    // Should have Ref Depth column + 2 integration columns (lgp, crewai)
    const headers = getAllByTestId(/^integration-header-/);
    // At least the non-reference integrations
    expect(headers.length).toBeGreaterThanOrEqual(1);
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
    // At least 2 chips (ref col + crewai col for the one feature)
    expect(depthChips.length).toBeGreaterThanOrEqual(2);
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
});
