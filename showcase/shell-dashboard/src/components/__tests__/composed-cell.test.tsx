/**
 * Unit tests for ComposedCell — overlay-aware cell renderer that composes
 * different content layers based on which overlays are currently active.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ComposedCell } from "../composed-cell";
import type { Overlay } from "../composed-cell";
import type { CellContext } from "@/components/feature-grid";
import type { CatalogCell } from "@/components/depth-utils";
import type { LiveStatusMap } from "@/lib/live-status";

// ---------------------------------------------------------------------------
// Mocks — we mock child components to isolate ComposedCell's layer logic
// ---------------------------------------------------------------------------

vi.mock("@/components/cell-pieces", () => ({
  urlsFor: vi.fn(() => ({
    demoUrl: "https://demo.test/preview",
    codeUrl: "https://demo.test/code",
    hostedUrl: "https://hosted.test",
  })),
  CellStatus: vi.fn(({ ctx }: { ctx: CellContext }) => (
    <div data-testid="mock-cell-status">{ctx.feature.id}</div>
  )),
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

vi.mock("@/components/command-cell", () => ({
  CommandCell: vi.fn(({ ctx }: { ctx: CellContext }) => (
    <div data-testid="mock-command-cell">{ctx.demo.command}</div>
  )),
}));

vi.mock("@/components/depth-chip", () => ({
  DepthChip: vi.fn(
    ({
      depth,
      regression,
    }: {
      depth: number;
      status: string;
      regression?: boolean;
    }) => (
      <span
        data-testid="mock-depth-chip"
        data-regression={String(!!regression)}
      >
        D{depth}
      </span>
    ),
  ),
}));

vi.mock("@/components/depth-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/depth-utils")
  >("@/components/depth-utils");
  return {
    ...actual,
    deriveDepth: vi.fn(() => ({
      achieved: 2,
      isRegression: false,
      unsupported: false,
    })),
  };
});

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
      features: ["chat-text"],
      demos: [
        {
          id: "chat-text",
          name: "Chat Text",
          description: "Basic text chat",
          tags: [],
          route: "/chat",
        },
      ],
    },
    feature: {
      id: "chat-text",
      name: "Chat Text",
      category: "chat-ui",
      description: "Basic text chat feature",
      kind: "primary",
    },
    demo: {
      id: "chat-text",
      name: "Chat Text",
      description: "Basic text chat",
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

describe("ComposedCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only Links layer when overlays = {links}", () => {
    const ctx = makeCtx();
    const { getByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("links")} />,
    );

    // Links layer present: Demo and Code links
    expect(getByText("Demo")).toBeInTheDocument();
    expect(getByText("</>")).toBeInTheDocument();

    // Other layers absent
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
    expect(queryByTestId("health-layer")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();
  });

  it("renders only Depth layer when overlays = {depth}", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    const { getByTestId, queryByText, queryByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("depth")}
        catalogCell={catalogCell}
      />,
    );

    // Depth layer present
    expect(getByTestId("depth-layer")).toBeInTheDocument();
    expect(getByTestId("mock-depth-chip")).toBeInTheDocument();

    // Other layers absent
    expect(queryByText("Demo")).not.toBeInTheDocument();
    expect(queryByTestId("health-layer")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();
  });

  it("renders only Health layer when overlays = {health}", () => {
    const ctx = makeCtx();
    const { getByTestId, queryByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("health")} />,
    );

    // Health layer present
    expect(getByTestId("health-layer")).toBeInTheDocument();
    expect(getByTestId("mock-cell-status")).toBeInTheDocument();

    // Other layers absent
    expect(queryByText("Demo")).not.toBeInTheDocument();
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
    expect(queryByTestId("docs-layer")).not.toBeInTheDocument();
  });

  it("renders only Docs layer when overlays = {docs}", () => {
    const ctx = makeCtx();
    const { getByTestId, queryByText, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("docs")} />,
    );

    // Docs layer present
    expect(getByTestId("docs-layer")).toBeInTheDocument();
    expect(getByTestId("mock-docs-row")).toBeInTheDocument();

    // Other layers absent
    expect(queryByText("Demo")).not.toBeInTheDocument();
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
    expect(queryByTestId("health-layer")).not.toBeInTheDocument();
  });

  it("renders Links + Depth stacked when both active", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    const { getByText, getByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("links", "depth")}
        catalogCell={catalogCell}
      />,
    );

    // Both layers present
    expect(getByText("Demo")).toBeInTheDocument();
    expect(getByTestId("depth-layer")).toBeInTheDocument();

    // Verify stacking order: links first, then depth
    const composedCell = getByTestId("composed-cell");
    const children = Array.from(composedCell.children);
    expect(children.length).toBe(2);

    // First child contains Demo link, second contains depth chip
    expect(children[0].textContent).toContain("Demo");
    expect(
      children[1].querySelector("[data-testid='mock-depth-chip']"),
    ).toBeTruthy();
  });

  it("renders 3 layers when all active — docs deduped by health", () => {
    const ctx = makeCtx();
    const catalogCell = makeCatalogCell();
    const { getByText, getByTestId, queryByTestId } = render(
      <ComposedCell
        ctx={ctx}
        overlays={overlaySet("links", "depth", "health", "docs", "parity")}
        catalogCell={catalogCell}
      />,
    );

    expect(getByText("Demo")).toBeInTheDocument();
    expect(getByTestId("depth-layer")).toBeInTheDocument();
    expect(getByTestId("health-layer")).toBeInTheDocument();
    // DocsLayer suppressed when health is active (CellStatus already includes docs)
    expect(queryByTestId("docs-layer")).toBeNull();

    const composedCell = getByTestId("composed-cell");
    const children = Array.from(composedCell.children);
    expect(children.length).toBe(3);
  });

  it("applies opacity-60 for testing-kind features", () => {
    const ctx = makeCtx({
      feature: {
        id: "chat-text",
        name: "Chat Text",
        category: "chat-ui",
        description: "Basic text chat feature",
        kind: "testing",
      },
    });
    const { getByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("links")} />,
    );

    const composedCell = getByTestId("composed-cell");
    expect(composedCell.className).toContain("opacity-60");
  });

  it("renders CommandCell for command demos when links overlay active", () => {
    const ctx = makeCtx({
      demo: {
        id: "cli-start",
        name: "CLI Start",
        description: "Start via CLI",
        tags: [],
        command: "npx copilotkit@latest",
      },
    });
    const { getByTestId, queryByText } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("links")} />,
    );

    // CommandCell rendered (not Demo/Code links)
    expect(getByTestId("mock-command-cell")).toBeInTheDocument();
    expect(getByTestId("mock-command-cell").textContent).toBe(
      "npx copilotkit@latest",
    );
    expect(queryByText("Demo")).not.toBeInTheDocument();
  });

  it("renders empty div when only parity overlay is active", () => {
    const ctx = makeCtx();
    const { getByTestId, queryByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("parity")} />,
    );

    // Empty cell rendered
    expect(getByTestId("composed-cell-empty")).toBeInTheDocument();
    expect(queryByTestId("composed-cell")).not.toBeInTheDocument();
  });

  it("does not apply opacity-60 for primary-kind features", () => {
    const ctx = makeCtx(); // default is "primary"
    const { getByTestId } = render(
      <ComposedCell ctx={ctx} overlays={overlaySet("links")} />,
    );

    const composedCell = getByTestId("composed-cell");
    expect(composedCell.className).not.toContain("opacity-60");
  });
});
