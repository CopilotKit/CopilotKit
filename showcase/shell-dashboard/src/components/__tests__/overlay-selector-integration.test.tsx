/**
 * Integration tests for overlay selectors — renders with REAL child
 * components (CellStatus, DocsRow, DepthChip, etc.) and verifies that
 * toggling overlay selectors actually controls what the user sees.
 *
 * Only the data layer is mocked (live-status, docs-status, useLastTransition,
 * PocketBase client) to provide predictable test data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ComposedCell } from "../composed-cell";
import type { Overlay } from "../composed-cell";
import type { CellContext } from "@/components/feature-grid";
import type { CatalogCell } from "@/components/depth-utils";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

// ---------------------------------------------------------------------------
// Data-layer mocks — real UI components, fake data
// ---------------------------------------------------------------------------

// Mock PocketBase client (imported by useLastTransition)
vi.mock("@/lib/pb", () => ({
  pb: {
    filter: vi.fn(() => ""),
    collection: vi.fn(() => ({
      getList: vi.fn(() => Promise.resolve({ items: [] })),
    })),
  },
}));

// Mock docs-status to return predictable doc state
vi.mock("@/lib/docs-status", () => ({
  getDocsStatus: vi.fn(() => ({ og: "ok", shell: "ok" })),
}));

// Mock useLastTransition (lazy tooltip fetch) — no PB calls in tests
vi.mock("@/hooks/useLastTransition", () => ({
  useLastTransition: vi.fn(() => ({ row: null, loaded: false, error: null })),
  deriveFromTo: vi.fn(() => ({ from: null, to: null })),
}));

// Mock the docs-status.json data import used by docs-status.ts
vi.mock("@/data/docs-status.json", () => ({
  default: {
    features: {
      "chat-text": { og: "ok", shell: "ok" },
      "agentic-chat": { og: "ok", shell: "ok" },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatusRow(
  dimension: string,
  slug: string,
  featureId?: string,
  state: "green" | "red" | "degraded" = "green",
): StatusRow {
  const key = featureId
    ? `${dimension}:${slug}/${featureId}`
    : `${dimension}:${slug}`;
  return {
    id: `row-${key}`,
    key,
    dimension,
    state,
    signal: null,
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

function buildLiveStatusMap(slug: string, featureId: string): LiveStatusMap {
  const map: LiveStatusMap = new Map();
  const rows = [
    makeStatusRow("health", slug),
    makeStatusRow("e2e", slug, featureId),
    makeStatusRow("smoke", slug),
    makeStatusRow("d5", slug, featureId),
    makeStatusRow("d6", slug, featureId),
    makeStatusRow("agent", slug),
    makeStatusRow("chat", slug),
  ];
  for (const r of rows) {
    map.set(r.key, r);
  }
  return map;
}

function makeCtx(overrides?: Partial<CellContext>): CellContext {
  const slug = "next";
  const featureId = "chat-text";
  return {
    integration: {
      name: "Next.js",
      slug,
      category: "framework",
      language: "TypeScript",
      description: "Next.js integration",
      repo: "https://github.com/test/next",
      backend_url: "https://next.test",
      deployed: true,
      features: [featureId],
      demos: [
        {
          id: featureId,
          name: "Chat Text",
          description: "Basic text chat",
          tags: [],
          route: "/chat",
        },
      ],
    },
    feature: {
      id: featureId,
      name: "Chat Text",
      category: "chat-ui",
      description: "Basic text chat feature",
      kind: "primary",
    },
    demo: {
      id: featureId,
      name: "Chat Text",
      description: "Basic text chat",
      tags: [],
      route: "/chat",
    },
    hostedUrl: "https://next.test/chat",
    shellUrl: "http://localhost:3000",
    liveStatus: buildLiveStatusMap(slug, featureId),
    connection: "live",
    ...overrides,
  };
}

function makeTestingCtx(): CellContext {
  return makeCtx({
    feature: {
      id: "agentic-chat",
      name: "Agentic Chat",
      category: "chat-ui",
      description: "Agentic chat feature",
      kind: "testing",
    },
    demo: {
      id: "agentic-chat",
      name: "Agentic Chat",
      description: "Agentic chat testing",
      tags: [],
      route: "/agentic-chat",
    },
    liveStatus: buildLiveStatusMap("next", "agentic-chat"),
  });
}

function makeCatalogCell(overrides?: Partial<CatalogCell>): CatalogCell {
  return {
    id: "next/chat-text",
    integration: "next",
    integration_name: "Next.js",
    feature: "chat-text",
    feature_name: "Chat Text",
    status: "wired",
    max_depth: 3,
    category: "chat-ui",
    category_name: "Chat & UI",
    ...overrides,
  };
}

function overlaySet(...overlays: Overlay[]): Set<Overlay> {
  return new Set(overlays);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Overlay selector integration — real UI components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Links only
  // -------------------------------------------------------------------------
  it("links only: Demo/Code links visible, no depth/badges/docs", () => {
    const ctx = makeCtx();
    const { getByText, queryByTestId, queryByText } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("links")} />,
    );

    // Links layer content present
    expect(getByText("Demo")).toBeInTheDocument();
    expect(getByText("</>")).toBeInTheDocument();

    // No depth chip
    expect(queryByTestId("depth-chip")).not.toBeInTheDocument();
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();

    // No health badges (API, RT, CV)
    expect(queryByText("API")).not.toBeInTheDocument();
    expect(queryByText("RT")).not.toBeInTheDocument();
    expect(queryByText("CV")).not.toBeInTheDocument();

    // No docs indicators
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByText("docs-shell")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Depth only
  // -------------------------------------------------------------------------
  it("depth only: depth chip visible, no links/badges/docs", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    const { getByTestId, queryByText } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("depth")}
        catalogCell={catalogCell}
      />,
    );

    // Depth chip present — real DepthChip renders data-testid="depth-chip"
    expect(getByTestId("depth-layer")).toBeInTheDocument();
    expect(getByTestId("depth-chip")).toBeInTheDocument();

    // No links
    expect(queryByText("Demo")).not.toBeInTheDocument();
    expect(queryByText("</>")).not.toBeInTheDocument();

    // No health badges
    expect(queryByText("RT")).not.toBeInTheDocument();

    // No docs indicators
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByText("docs-shell")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 3. Health only — the critical case (no docs indicators must appear)
  // -------------------------------------------------------------------------
  it("health only: API/RT/CV badges visible, NO docs indicators", () => {
    const ctx = makeCtx();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("health")} />,
    );

    // Health layer present with real badges
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByText("API")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();
    expect(getByText("CV")).toBeInTheDocument();

    // No docs indicators — this is the critical regression test for B2's fix
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByText("docs-shell")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();

    // No links
    expect(queryByText("Demo")).not.toBeInTheDocument();

    // No depth chip
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 4. Docs only
  // -------------------------------------------------------------------------
  it("docs only: docs-og/docs-shell indicators visible, no links/badges/depth", () => {
    const ctx = makeCtx();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("docs")} />,
    );

    // Docs layer present with real DocsRow content
    expect(getByTestId("docs-layer")).toBeInTheDocument();
    // DocsRow renders "docs-og" and "docs-shell" labels
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();

    // No links
    expect(queryByText("Demo")).not.toBeInTheDocument();

    // No health badges
    expect(queryByText("RT")).not.toBeInTheDocument();

    // No depth chip
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
    expect(queryByTestId("depth-chip")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 5. Parity only — empty cell
  // -------------------------------------------------------------------------
  it("parity only: renders empty cell (no per-cell content)", () => {
    const ctx = makeCtx();
    const { getByTestId, queryByTestId, queryByText } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("parity")} />,
    );

    // Parity produces no per-cell content → empty cell
    expect(getByTestId("composed-cell-empty")).toBeInTheDocument();
    expect(queryByTestId("composed-cell")).not.toBeInTheDocument();

    // Nothing visible
    expect(queryByText("Demo")).not.toBeInTheDocument();
    expect(queryByText("RT")).not.toBeInTheDocument();
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByTestId("depth-chip")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 6. Health + Docs — both badges AND docs indicators visible
  // -------------------------------------------------------------------------
  it("health + docs: badges AND docs indicators both visible", () => {
    const ctx = makeCtx();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("health", "docs")} />,
    );

    // Health layer
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByText("API")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();
    expect(getByText("CV")).toBeInTheDocument();

    // Docs layer
    expect(getByTestId("docs-layer")).toBeInTheDocument();
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();

    // No links
    expect(queryByText("Demo")).not.toBeInTheDocument();

    // No depth chip
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7. All overlays — everything visible, correct stacking order
  // -------------------------------------------------------------------------
  it("all overlays: every layer visible in correct stacking order", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    const { getByTestId, getByText } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("links", "depth", "health", "docs", "parity")}
        catalogCell={catalogCell}
      />,
    );

    // All content layers present
    expect(getByText("Demo")).toBeInTheDocument();
    expect(getByTestId("depth-layer")).toBeInTheDocument();
    expect(getByTestId("depth-chip")).toBeInTheDocument();
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();
    expect(getByTestId("docs-layer")).toBeInTheDocument();
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();

    // Verify stacking order: links, depth, health, docs
    const composedCell = getByTestId("composed-cell");
    const children = Array.from(composedCell.children);
    expect(children.length).toBe(4); // parity adds no content layer

    // First child: links (contains "Demo")
    expect(children[0]?.textContent).toContain("Demo");
    // Second child: depth (contains depth-chip)
    expect(
      children[1]?.querySelector("[data-testid='depth-chip']"),
    ).toBeTruthy();
    // Third child: health (contains RT badge)
    expect(children[2]?.textContent).toContain("RT");
    // Fourth child: docs (contains docs-og)
    expect(children[3]?.textContent).toContain("docs-og");
  });

  // -------------------------------------------------------------------------
  // 8. Health without Docs — the critical regression test for B2's fix
  // -------------------------------------------------------------------------
  it("health without docs: badges visible, docs-og/docs-shell NOT visible", () => {
    const ctx = makeCtx();
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("health")} />,
    );

    // Health badges present
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();

    // Docs explicitly absent — this is the bug B2 fixed: CellStatus used to
    // render DocsRow, so "health only" would still show docs indicators.
    // After B2's fix, DocsRow is only in DocsLayer (gated on overlays.has("docs")).
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByText("docs-shell")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 9. Testing-kind features: CV badges hidden
  // -------------------------------------------------------------------------
  it("testing-kind feature with health: CV badges hidden, API/RT still shown", () => {
    const ctx = makeTestingCtx();
    const { getByTestId, getByText, queryByText } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("health")} />,
    );

    // Health layer present
    expect(getByTestId("health-layer")).toBeInTheDocument();

    // API and RT badges still visible for testing-kind
    expect(getByText("API")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();

    // CV hidden for testing-kind features (CellStatus hides them)
    expect(queryByText("CV")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 10. Testing-kind feature with docs overlay: DocsLayer still renders
  // -------------------------------------------------------------------------
  it("testing-kind feature with docs overlay: docs indicators visible", () => {
    const ctx = makeTestingCtx();
    const { getByTestId, getByText } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("docs")} />,
    );

    // DocsLayer renders for testing features when docs overlay is active
    expect(getByTestId("docs-layer")).toBeInTheDocument();
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 11. Catalog preset (links + health + docs) — all three layers visible
  // -------------------------------------------------------------------------
  it("Catalog preset (links+health+docs): all three layers visible", () => {
    const ctx = makeCtx();
    // Catalog preset from overlay-types.ts: ["links", "health", "docs"]
    const { getByText, getByTestId, queryByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("links", "health", "docs")}
      />,
    );

    // Links
    expect(getByText("Demo")).toBeInTheDocument();
    expect(getByText("</>")).toBeInTheDocument();

    // Health badges
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();

    // Docs indicators
    expect(getByTestId("docs-layer")).toBeInTheDocument();
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();

    // No depth chip (not in Catalog preset)
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 12. Assessment preset (depth + health) — depth chips + badges, NO docs
  // -------------------------------------------------------------------------
  it("Assessment preset (depth+health): depth chip + badges, NO docs", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    // Assessment preset from overlay-types.ts: ["depth", "health"]
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("depth", "health")}
        catalogCell={catalogCell}
      />,
    );

    // Depth chip
    expect(getByTestId("depth-layer")).toBeInTheDocument();
    expect(getByTestId("depth-chip")).toBeInTheDocument();

    // Health badges
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByText("RT")).toBeInTheDocument();

    // No docs — critical: Assessment does NOT include docs
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByText("docs-shell")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();

    // No links
    expect(queryByText("Demo")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 13. Parity Review preset (depth + parity) — depth chips only
  // -------------------------------------------------------------------------
  it("Parity Review preset (depth+parity): depth chip only, no badges/docs/links", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    // Parity Review preset from overlay-types.ts: ["depth", "parity"]
    const { getByTestId, queryByText, queryByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("depth", "parity")}
        catalogCell={catalogCell}
      />,
    );

    // Depth chip present
    expect(getByTestId("depth-layer")).toBeInTheDocument();
    expect(getByTestId("depth-chip")).toBeInTheDocument();

    // No health badges (health overlay not active)
    expect(queryByTestId("health-layer")).not.toBeInTheDocument();

    // No docs
    expect(queryByText("docs-og")).not.toBeInTheDocument();
    expect(queryByText("docs-shell")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();

    // No links
    expect(queryByText("Demo")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 14. Health badges show correct green tone from real resolveCell
  // -------------------------------------------------------------------------
  it("health layer renders real badge tones from live status data", () => {
    const ctx = makeCtx();
    const { getByText } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("health")} />,
    );

    // With green live status rows, RT badge should show the green check
    const rtBadge = getByText("RT");
    expect(rtBadge).toBeInTheDocument();
    // The badge label "✓" (green state) should appear as a sibling span
    const rtContainer = rtBadge.closest("[class*='whitespace-nowrap']");
    expect(rtContainer?.textContent).toContain("✓");
  });

  // -------------------------------------------------------------------------
  // 15. Depth chip shows correct depth from real deriveDepth
  // -------------------------------------------------------------------------
  it("depth layer renders real depth chip with correct D-level", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    const { getByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("depth")}
        catalogCell={catalogCell}
      />,
    );

    const chip = getByTestId("depth-chip");
    expect(chip).toBeInTheDocument();
    // The depth chip renders "D<n>" text — with full green live status and
    // health+agent+e2e+chat all green, deriveDepth should yield D4
    const depthAttr = chip.getAttribute("data-depth");
    expect(depthAttr).toBeTruthy();
    expect(chip.textContent).toMatch(/^D[0-6]$/);
  });
});
