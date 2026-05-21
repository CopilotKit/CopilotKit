/**
 * Unit tests for UnifiedCell -- single rendering codepath for Coverage-tab
 * cells that consumes a pre-computed CellModel.
 *
 * Verifies:
 *   1. Unsupported cells render only the ban icon (Bug 3 regression guard)
 *   2. Supported cells render depth chip with correct chipColor
 *   3. Only shows badges for test levels that exist
 *   4. Shows all three badges when all levels exist
 *   5. Hides badges when health overlay is not active
 *   6. Hides depth chip when depth overlay is not active
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { UnifiedCell } from "../unified-cell";
import type { UnifiedCellProps } from "../unified-cell";
import type { CellContext } from "@/components/feature-grid";
import type { CellModel, TestLevel, ChipColor } from "@/lib/cell-model";
import type { Overlay } from "@/lib/overlay-types";
import type { LiveStatusMap } from "@/lib/live-status";

// ---------------------------------------------------------------------------
// Mocks -- isolate UnifiedCell's rendering logic from child components
// ---------------------------------------------------------------------------

vi.mock("@/components/depth-chip", () => ({
  DepthChip: vi.fn(
    ({
      depth,
      chipColor,
    }: {
      depth: number;
      status: string;
      chipColor?: string;
    }) => (
      <span data-testid="mock-depth-chip" data-chip-color={chipColor ?? ""}>
        D{depth}
      </span>
    ),
  ),
}));

vi.mock("@/components/badges", () => ({
  Badge: vi.fn(
    ({
      name,
      state,
    }: {
      name: string;
      state: { tone: string; label: string };
      title?: string;
    }) => (
      <span data-testid={`mock-badge-${name}`} data-tone={state.tone}>
        {name} {state.label}
      </span>
    ),
  ),
  FlashOnChange: vi.fn(
    ({ children }: { children: React.ReactNode; tone: string }) => (
      <span data-testid="mock-flash">{children}</span>
    ),
  ),
}));

vi.mock("@/components/cell-drilldown", () => ({
  CellDrilldown: vi.fn(() => (
    <div data-testid="mock-cell-drilldown">drilldown</div>
  )),
}));

vi.mock("@/components/command-cell", () => ({
  CommandCell: vi.fn(({ ctx }: { ctx: CellContext }) => (
    <div data-testid="mock-command-cell">{ctx.demo.command}</div>
  )),
}));

vi.mock("@/components/link-preview", () => ({
  LinkPreview: vi.fn(
    ({ children, href }: { children: React.ReactNode; href: string }) => (
      <span data-testid="mock-link-preview" data-href={href}>
        {children}
      </span>
    ),
  ),
}));

vi.mock("@/components/cell-pieces", () => ({
  urlsFor: vi.fn(() => ({
    demoUrl: "https://demo.test/preview",
    codeUrl: "https://demo.test/code",
    hostedUrl: "https://hosted.test",
  })),
  DocsRow: vi.fn(
    ({
      feature,
    }: {
      integration: unknown;
      feature: { id: string };
      shellUrl: string;
    }) => <div data-testid="mock-docs-row">{feature.id}</div>,
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyLiveStatus: LiveStatusMap = new Map();

function makeCtx(overrides?: Partial<CellContext>): CellContext {
  return {
    integration: {
      name: "Next.js",
      slug: "next",
      category: "framework",
      language: "TypeScript",
      description: "Next.js integration",
      repo: "https://github.com/test/next",
      backend_url: "https://next.test",
      deployed: true,
      features: ["agentic-chat"],
      demos: [
        {
          id: "agentic-chat",
          name: "Agentic Chat",
          description: "AI chat",
          tags: [],
          route: "/chat",
        },
      ],
    },
    feature: {
      id: "agentic-chat",
      name: "Agentic Chat",
      category: "chat-ui",
      description: "AI chat feature",
      kind: "primary",
    },
    demo: {
      id: "agentic-chat",
      name: "Agentic Chat",
      description: "AI chat",
      tags: [],
      route: "/chat",
    },
    hostedUrl: "https://next.test/chat",
    shellUrl: "http://localhost:3000",
    liveStatus: emptyLiveStatus,
    connection: "live",
    ...overrides,
  };
}

function makeLevel(
  exists: boolean,
  status: "green" | "red" | "amber" | null = null,
): TestLevel {
  return { exists, status, row: null };
}

function makeModel(overrides?: Partial<CellModel>): CellModel {
  return {
    supported: true,
    d3: makeLevel(true, "green"),
    d4: makeLevel(true, "green"),
    d5: makeLevel(true, "green"),
    achievedDepth: 5,
    ceilingDepth: 5,
    chipColor: "green",
    isRegression: false,
    ...overrides,
  };
}

function overlaySet(...overlays: Overlay[]): Set<Overlay> {
  return new Set(overlays);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UnifiedCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Unsupported cell renders only ban icon (Bug 3) ────────
  describe("unsupported cells", () => {
    it("renders only the ban icon with no badges and no depth chip", () => {
      const ctx = makeCtx();
      const model = makeModel({ supported: false });
      const { getByTestId, queryByTestId, queryAllByTestId } = render(
        <UnifiedCell
          ctx={ctx}
          model={model}
          overlays={overlaySet("links", "depth", "health", "docs")}
        />,
      );

      // Unsupported marker present
      expect(getByTestId("unified-cell-unsupported")).toBeInTheDocument();

      // No depth chip rendered
      expect(queryByTestId("mock-depth-chip")).not.toBeInTheDocument();

      // No badges rendered
      expect(queryByTestId("mock-badge-API")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-RT")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-CV")).not.toBeInTheDocument();

      // No layer divs rendered
      expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
      expect(queryByTestId("health-layer")).not.toBeInTheDocument();
      expect(queryByTestId("docs-layer")).not.toBeInTheDocument();
    });

    it("renders ban icon even when all overlays are active", () => {
      const ctx = makeCtx();
      const model = makeModel({
        supported: false,
        d3: null,
        d4: null,
        d5: null,
        achievedDepth: 0,
        ceilingDepth: 0,
        chipColor: "gray",
      });
      const { getByTestId, queryByTestId } = render(
        <UnifiedCell
          ctx={ctx}
          model={model}
          overlays={overlaySet("links", "depth", "health", "docs", "parity")}
        />,
      );

      expect(getByTestId("unified-cell-unsupported")).toBeInTheDocument();
      expect(queryByTestId("unified-cell")).not.toBeInTheDocument();
    });
  });

  // ── Test 2: Depth chip uses pre-computed chipColor ────────────────
  describe("depth chip rendering", () => {
    it("renders depth chip with correct chipColor from model", () => {
      const ctx = makeCtx();
      const model = makeModel({ chipColor: "amber", achievedDepth: 4 });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("depth")} />,
      );

      const chip = getByTestId("mock-depth-chip");
      expect(chip).toBeInTheDocument();
      expect(chip.getAttribute("data-chip-color")).toBe("amber");
      expect(chip.textContent).toBe("D4");
    });

    it("renders depth chip as green when model says green", () => {
      const ctx = makeCtx();
      const model = makeModel({ chipColor: "green", achievedDepth: 5 });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("depth")} />,
      );

      const chip = getByTestId("mock-depth-chip");
      expect(chip.getAttribute("data-chip-color")).toBe("green");
    });

    it("renders depth chip as red when model says red", () => {
      const ctx = makeCtx();
      const model = makeModel({ chipColor: "red", achievedDepth: 3 });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("depth")} />,
      );

      const chip = getByTestId("mock-depth-chip");
      expect(chip.getAttribute("data-chip-color")).toBe("red");
    });
  });

  // ── Test 3: Only shows badges for test levels that exist ──────────
  describe("badge existence filtering", () => {
    it("shows API badge when D3 exists but hides RT badge when D4 is missing", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(false), // D4 missing -- no RT badge
        d5: makeLevel(true, "red"),
      });
      const { getByTestId, queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      // API badge present (D3 exists)
      expect(getByTestId("mock-badge-API")).toBeInTheDocument();
      // RT badge absent (D4 does not exist)
      expect(queryByTestId("mock-badge-RT")).not.toBeInTheDocument();
      // CV badge present (D5 exists)
      expect(getByTestId("mock-badge-CV")).toBeInTheDocument();
    });

    it("hides all badges when no test levels exist", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(false),
        d4: makeLevel(false),
        d5: makeLevel(false),
      });
      const { queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      expect(queryByTestId("mock-badge-API")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-RT")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-CV")).not.toBeInTheDocument();
    });

    it("hides badge when level is null", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: null,
        d4: makeLevel(true, "green"),
        d5: null,
      });
      const { getByTestId, queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      expect(queryByTestId("mock-badge-API")).not.toBeInTheDocument();
      expect(getByTestId("mock-badge-RT")).toBeInTheDocument();
      expect(queryByTestId("mock-badge-CV")).not.toBeInTheDocument();
    });
  });

  // ── Test 4: Shows all three badges when all levels exist ──────────
  describe("all badges visible", () => {
    it("shows API, RT, and CV badges when all three levels exist", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(true, "amber"),
        d5: makeLevel(true, "red"),
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      const apiBadge = getByTestId("mock-badge-API");
      expect(apiBadge).toBeInTheDocument();
      expect(apiBadge.getAttribute("data-tone")).toBe("green");

      const rtBadge = getByTestId("mock-badge-RT");
      expect(rtBadge).toBeInTheDocument();
      expect(rtBadge.getAttribute("data-tone")).toBe("amber");

      const cvBadge = getByTestId("mock-badge-CV");
      expect(cvBadge).toBeInTheDocument();
      expect(cvBadge.getAttribute("data-tone")).toBe("red");
    });
  });

  // ── Test 5: Hides badges when health overlay is not active ────────
  describe("overlay gating", () => {
    it("hides health badges when health overlay is off", () => {
      const ctx = makeCtx();
      const model = makeModel(); // all levels exist
      const { queryByTestId } = render(
        <UnifiedCell
          ctx={ctx}
          model={model}
          overlays={overlaySet("links", "depth")} // health NOT in set
        />,
      );

      expect(queryByTestId("health-layer")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-API")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-RT")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-CV")).not.toBeInTheDocument();
    });

    // ── Test 6: Hides depth chip when depth overlay is not active ───
    it("hides depth chip when depth overlay is off", () => {
      const ctx = makeCtx();
      const model = makeModel();
      const { queryByTestId } = render(
        <UnifiedCell
          ctx={ctx}
          model={model}
          overlays={overlaySet("links", "health")} // depth NOT in set
        />,
      );

      expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
      expect(queryByTestId("mock-depth-chip")).not.toBeInTheDocument();
    });

    it("renders empty when only parity overlay active", () => {
      const ctx = makeCtx();
      const model = makeModel();
      const { getByTestId, queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("parity")} />,
      );

      expect(getByTestId("unified-cell-empty")).toBeInTheDocument();
      expect(queryByTestId("unified-cell")).not.toBeInTheDocument();
    });
  });

  // ── Additional coverage ───────────────────────────────────────────
  describe("badge tone mapping", () => {
    it("maps green status to green tone with check mark", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(false),
        d5: makeLevel(false),
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      const badge = getByTestId("mock-badge-API");
      expect(badge.getAttribute("data-tone")).toBe("green");
      expect(badge.textContent).toContain("✓");
    });

    it("maps null status to gray tone with question mark", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, null), // exists but no status yet
        d4: makeLevel(false),
        d5: makeLevel(false),
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      const badge = getByTestId("mock-badge-API");
      expect(badge.getAttribute("data-tone")).toBe("gray");
      expect(badge.textContent).toContain("?");
    });
  });
});
