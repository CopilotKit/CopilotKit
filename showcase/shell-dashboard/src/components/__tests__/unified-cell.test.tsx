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
import { UnifiedCell, arePropsEqual } from "../unified-cell";
import type { UnifiedCellProps } from "../unified-cell";
import type { CellContext } from "@/components/feature-grid";
import type { CellModel, TestLevel } from "@/lib/cell-model";
import type { Overlay } from "@/lib/overlay-types";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";
import { keyFor } from "@/lib/live-status";

// ---------------------------------------------------------------------------
// Mocks -- isolate UnifiedCell's rendering logic from child components
// ---------------------------------------------------------------------------

vi.mock("@/components/depth-chip", () => ({
  DepthChip: vi.fn(
    ({
      depth,
      chipColor,
      unreachable,
      commTooltip,
    }: {
      depth: number;
      status: string;
      chipColor?: string;
      unreachable?: boolean;
      commTooltip?: string;
    }) => (
      <span
        data-testid="mock-depth-chip"
        data-chip-color={chipColor ?? ""}
        data-unreachable={unreachable ? "1" : "0"}
        data-comm-tooltip={commTooltip ?? ""}
      >
        D{depth}
      </span>
    ),
  ),
}));

vi.mock("@/components/badges", () => ({
  // Mirror the REAL Badge contract: a "?" label means no-data and the real
  // Badge returns null (hides). Replicating that here keeps these tests from
  // being overfit to a mock that renders unconditionally — a gated D6 routed
  // through label "?" would vanish in production but pass against a naive mock.
  Badge: vi.fn(
    ({
      name,
      state,
    }: {
      name: string;
      state: { tone: string; label: string };
      title?: string;
    }) =>
      state.label === "?" ? null : (
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
    d6: makeLevel(false),
    d6Effective: null,
    achievedDepth: 5,
    ceilingDepth: 5,
    chipColor: "green",
    isRegression: false,
    surfaceState: "green",
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
      const { getByTestId, queryByTestId } = render(
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
      expect(queryByTestId("mock-badge-UI")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-BE")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-1P")).not.toBeInTheDocument();

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
    it("shows E2E badge when D3 exists but hides BE badge when D4 is missing", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(false), // D4 missing -- no BE badge
        d5: makeLevel(true, "red"),
      });
      const { getByTestId, queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      // E2E badge present (D3 exists)
      expect(getByTestId("mock-badge-UI")).toBeInTheDocument();
      // BE badge absent (D4 does not exist)
      expect(queryByTestId("mock-badge-BE")).not.toBeInTheDocument();
      // 1P badge present (D5 exists)
      expect(getByTestId("mock-badge-1P")).toBeInTheDocument();
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

      expect(queryByTestId("mock-badge-UI")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-BE")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-1P")).not.toBeInTheDocument();
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

      expect(queryByTestId("mock-badge-UI")).not.toBeInTheDocument();
      expect(getByTestId("mock-badge-BE")).toBeInTheDocument();
      expect(queryByTestId("mock-badge-1P")).not.toBeInTheDocument();
    });
  });

  // ── Test 4: Shows all three badges when all levels exist ──────────
  describe("all badges visible", () => {
    it("shows E2E, BE, and 1P badges when all three levels exist", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(true, "amber"),
        d5: makeLevel(true, "red"),
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      const e2eBadge = getByTestId("mock-badge-UI");
      expect(e2eBadge).toBeInTheDocument();
      expect(e2eBadge.getAttribute("data-tone")).toBe("green");

      const rtBadge = getByTestId("mock-badge-BE");
      expect(rtBadge).toBeInTheDocument();
      expect(rtBadge.getAttribute("data-tone")).toBe("amber");

      const cvBadge = getByTestId("mock-badge-1P");
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
      expect(queryByTestId("mock-badge-UI")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-BE")).not.toBeInTheDocument();
      expect(queryByTestId("mock-badge-1P")).not.toBeInTheDocument();
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

    // ── d6 is a content-bearing overlay (surfaces depth + health) ─────
    // Regression guard: a {d6}-only set must NOT render a blank cell even
    // though only adaptive-stats-bar reads overlays.has("d6"). Per-cell the
    // d6 pill surfaces the depth chip + health badges (incl. the D6 badge).
    it("renders depth + health content (not blank) for a {d6}-only overlay set", () => {
      const ctx = makeCtx();
      // Fully-intact ladder (D3-D5 green by default) with a present green D6 →
      // d6Effective passes through as green, so the D6 badge renders visibly.
      // (The default makeModel d6Effective is null, which models a no-data
      //  ladder — that would correctly suppress the D6 badge, defeating this
      //  test's intent, so set it consistently here.)
      const model = makeModel({
        d6: makeLevel(true, "green"),
        d6Effective: "green",
      });
      const { getByTestId, queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("d6")} />,
      );

      // Cell is NOT the blank-empty placeholder.
      expect(queryByTestId("unified-cell-empty")).not.toBeInTheDocument();
      expect(getByTestId("unified-cell")).toBeInTheDocument();
      // Depth + health content surfaces, including the D6 badge.
      expect(getByTestId("depth-layer")).toBeInTheDocument();
      expect(getByTestId("health-layer")).toBeInTheDocument();
      expect(getByTestId("mock-badge-D6")).toBeInTheDocument();
    });
  });

  // ── D6 badge ladder-gating (D6 never green if D5 fails) ────────────
  describe("D6 badge reflects ladder-gated d6Effective", () => {
    it("renders a VISIBLE gated D6 badge ('—', gray) when D5 is red even though raw d6 is green", () => {
      const ctx = makeCtx();
      // Raw D6 dimension is green, but D5 is red so the ladder is broken
      // below D6 → d6Effective null. The D6 badge must render a real, VISIBLE
      // not-achieved indicator ("—", gray) — NOT a "?" that the real Badge
      // hides, and never green; 1P stays per-dimension red (diagnostic).
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(true, "green"),
        d5: makeLevel(true, "red"),
        d6: makeLevel(true, "green"),
        d6Effective: null,
        chipColor: "red",
        achievedDepth: 4,
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      // The gated D6 badge is PRESENT (does not vanish) and renders the
      // em-dash. With the mock honoring the real "?"→null rule, this would
      // FAIL against a naive "?"-emitting implementation — proving the fix.
      const d6Badge = getByTestId("mock-badge-D6");
      expect(d6Badge).toBeInTheDocument();
      expect(d6Badge.getAttribute("data-tone")).toBe("gray");
      expect(d6Badge.getAttribute("data-tone")).not.toBe("green");
      expect(d6Badge.textContent).toContain("—");

      // 1P badge still shows the real per-dimension D5 failure (red).
      expect(getByTestId("mock-badge-1P").getAttribute("data-tone")).toBe(
        "red",
      );
    });

    it("hides the D6 badge entirely when D6 has no data (does not exist)", () => {
      const ctx = makeCtx();
      // D6 not mapped/no row → does not exist. Gated rendering must NOT kick
      // in; the badge is simply absent (no "—" for a non-existent rung).
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(true, "green"),
        d5: makeLevel(true, "green"),
        d6: makeLevel(false),
        d6Effective: null,
        chipColor: "amber",
        achievedDepth: 5,
      });
      const { queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      expect(queryByTestId("mock-badge-D6")).not.toBeInTheDocument();
    });

    it("renders D6 badge green on a fully-intact ladder (d6Effective green)", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, "green"),
        d4: makeLevel(true, "green"),
        d5: makeLevel(true, "green"),
        d6: makeLevel(true, "green"),
        d6Effective: "green",
        chipColor: "green",
        achievedDepth: 6,
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      expect(getByTestId("mock-badge-D6").getAttribute("data-tone")).toBe(
        "green",
      );
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

      const badge = getByTestId("mock-badge-UI");
      expect(badge.getAttribute("data-tone")).toBe("green");
      expect(badge.textContent).toContain("✓");
    });

    it("hides a no-data (null status) rung — the real Badge nulls a '?' label", () => {
      const ctx = makeCtx();
      const model = makeModel({
        d3: makeLevel(true, null), // exists but no status yet → label "?"
        d4: makeLevel(false),
        d5: makeLevel(false),
      });
      const { queryByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("health")} />,
      );

      // A no-data rung emits label "?", which the real Badge hides → no badge.
      expect(queryByTestId("mock-badge-UI")).not.toBeInTheDocument();
    });
  });

  // ── REQ-B: pool comm-error → unreachable depth chip ─────────────────
  describe("pool comm-error overlay (REQ-B)", () => {
    it("renders the depth chip in the unreachable treatment when surfaceState is unreachable", () => {
      const ctx = makeCtx();
      const model = makeModel({
        surfaceState: "unreachable",
        // chipColor is preserved underneath — the overlay does not recolour it.
        chipColor: "green",
        commError: {
          kind: "worker-unreachable",
          message: "connect ECONNREFUSED",
          workerId: "worker-7",
          observedAt: new Date().toISOString(),
        },
      });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("depth")} />,
      );
      const chip = getByTestId("mock-depth-chip");
      expect(chip.getAttribute("data-unreachable")).toBe("1");
      // Tooltip names the comm-error kind AND the worker for triage.
      const tooltip = chip.getAttribute("data-comm-tooltip") ?? "";
      expect(tooltip).toContain("worker-unreachable");
      expect(tooltip).toContain("worker-7");
    });

    it("a normal red cell renders WITHOUT the unreachable treatment", () => {
      const ctx = makeCtx();
      const model = makeModel({ chipColor: "red", surfaceState: "red" });
      const { getByTestId } = render(
        <UnifiedCell ctx={ctx} model={model} overlays={overlaySet("depth")} />,
      );
      const chip = getByTestId("mock-depth-chip");
      expect(chip.getAttribute("data-unreachable")).toBe("0");
      expect(chip.getAttribute("data-chip-color")).toBe("red");
    });
  });

  // ── REQ-B: arePropsEqual watches the d6 AGGREGATE row (worker-death) ──
  describe("arePropsEqual aggregate comm-error watch (Fix 2)", () => {
    function commRow(key: string): StatusRow {
      return {
        id: `id-${key}`,
        key,
        dimension: "d6",
        state: "green",
        signal: {
          __fleetCommError: {
            kind: "worker-crashed-mid-job",
            message: "lease expired with no terminal report",
            workerId: "fleet-worker-3",
            observedAt: new Date().toISOString(),
          },
        },
        observed_at: new Date().toISOString(),
        transitioned_at: new Date().toISOString(),
        fail_count: 0,
        first_failure_at: null,
      };
    }

    it("forces a re-render when a comm error lands solely on the aggregate d6:<slug> row", () => {
      const slug = "next";
      // SAME model reference both renders — isolates the directKeys watch from
      // the modelsEqual backstop. Without keyFor("d6", slug) in directKeys this
      // returns true (skips the repaint) and the unreachable overlay is missed.
      const model = makeModel();
      const overlays = overlaySet("depth");

      const prevLive: LiveStatusMap = new Map();
      const nextLive: LiveStatusMap = new Map();
      // Only the aggregate row differs — it now carries the worker-death signal.
      nextLive.set(keyFor("d6", slug), commRow(keyFor("d6", slug)));

      // Share ALL ctx fields except liveStatus (arePropsEqual compares the
      // integration/feature/demo objects by reference, so a fresh makeCtx per
      // side would short-circuit on those before reaching the directKeys watch).
      const baseCtx = makeCtx({ liveStatus: prevLive });
      const prev: UnifiedCellProps = { ctx: baseCtx, model, overlays };
      const next: UnifiedCellProps = {
        ctx: { ...baseCtx, liveStatus: nextLive },
        model,
        overlays,
      };

      // false === "props differ, re-render". The aggregate-key watch must catch
      // the change to the aggregate row even with an identical model reference.
      expect(arePropsEqual(prev, next)).toBe(false);
    });

    it("still skips the re-render when nothing the cell reads changed (no false repaint)", () => {
      const model = makeModel();
      const overlays = overlaySet("depth");
      // Two distinct (empty) map identities but no watched key differs. Share
      // ctx fields so the comparison reaches (and passes) the directKeys loop.
      const baseCtx = makeCtx({ liveStatus: new Map() });
      const prev: UnifiedCellProps = { ctx: baseCtx, model, overlays };
      const next: UnifiedCellProps = {
        ctx: { ...baseCtx, liveStatus: new Map() },
        model,
        overlays,
      };
      expect(arePropsEqual(prev, next)).toBe(true);
    });
  });
});
