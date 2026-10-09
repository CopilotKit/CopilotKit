import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogData } from "@/data/catalog-types";
import type { Registry } from "@/lib/registry";
import type { StatusRow } from "@/lib/live-status";
import { buildCellModel } from "@/lib/cell-model";
import { DashboardPage } from "./dashboard-page";

const fixture = vi.hoisted(() => {
  const features = ["agentic-chat", "bad/feature"].map((id) => ({
    id,
    name: id,
    category: "chat-ui",
    description: id,
  }));
  const integrations = ["agno", "mastra"].map((slug) => ({
    slug,
    name: slug,
    category: "framework",
    language: "TypeScript",
    description: slug,
    repo: "https://example.test",
    backend_url: "https://example.test",
    deployed: true,
    features: features.map((f) => f.id),
    demos: features.map((f) => ({ ...f, tags: [], route: `/${f.id}` })),
    starter_validation: { supported: false, reason: "No starter" },
  }));
  const registry: Registry = {
    feature_registry: {
      version: "1",
      categories: [{ id: "chat-ui", name: "Chat" }],
      features,
    },
    integrations,
  };
  const catalog: CatalogData = {
    metadata: {
      reference: "agno",
      total_cells: 4,
      wired: 4,
      stub: 0,
      unshipped: 0,
      unsupported: 0,
      docs_only: 0,
    },
    cells: integrations.flatMap(({ slug }) =>
      features.map(({ id }) => ({
        id: `${slug}/${id}`,
        manifestation: "integrated",
        integration: slug,
        integration_name: slug,
        feature: id,
        feature_name: id,
        status: "wired",
        parity_tier: slug === "agno" ? "reference" : "at_parity",
        max_depth: 6,
        category: "chat-ui",
        category_name: "Chat",
      })),
    ),
  };
  const observed = new Date().toISOString();
  const rows: StatusRow[] = integrations.flatMap(({ slug }) =>
    [
      `e2e:${slug}/agentic-chat`,
      `chat:${slug}`,
      `tools:${slug}`,
      `d5:${slug}/agentic-chat`,
      `d6:${slug}/agentic-chat`,
    ].map((key) => ({
      id: key,
      key,
      dimension: key.split(":")[0],
      state: "green",
      signal: {},
      observed_at: observed,
      transitioned_at: observed,
      fail_count: 0,
      first_failure_at: null,
    })),
  );
  const overlays = new Set(["depth", "health", "parity", "d6"]);
  return { registry, catalog, rows, overlays };
});

vi.mock("@/data/registry.json", () => ({ default: fixture.registry }));
vi.mock("@/data/catalog.json", () => ({ default: fixture.catalog }));
vi.mock("@/hooks/useLiveStatus", () => ({
  useLiveStatus: () => ({
    rows: fixture.rows,
    status: "live",
    degraded: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-probes", () => ({
  useProbes: () => ({ data: { probes: [] } }),
  useTriggerProbe: () => ({ trigger: vi.fn() }),
}));
vi.mock("@/hooks/use-worker-runs", () => ({ useWorkerRunsPoll: () => null }));
vi.mock("@/hooks/useOverlays", () => ({
  useOverlays: () => ({
    overlays: fixture.overlays,
    activeTab: "matrix",
    toggle: vi.fn(),
    applyPreset: vi.fn(),
    setTab: vi.fn(),
    activePreset: null,
    selectedProbeId: null,
    selectProbe: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard cell fault isolation", () => {
  it("keeps valid cells and probe counts visible when another feature ID is invalid", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { rerender } = render(
      <DashboardPage shellUrl="https://example.test" />,
    );

    for (const slug of ["agno", "mastra"]) {
      expect(
        screen.getByTestId(`depth-btn-${slug}-agentic-chat`),
      ).toHaveTextContent("D6");
      expect(
        screen.getByTestId(`cell-error-${slug}-bad/feature`),
      ).toHaveTextContent("!");
    }
    expect(screen.getByRole("alert")).toHaveTextContent("2 cells unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Probe counts exclude unavailable cells",
    );
    expect(
      screen.getAllByTitle("1 green · 0 amber · 0 red of 1 signals"),
    ).toHaveLength(2);
    expect(
      within(screen.getByTestId("depth-distribution")).getByText("2"),
    ).toBeInTheDocument();

    // A subsequent feed update must not move the failure into a memo comparator.
    fixture.rows = fixture.rows.map((row) => ({ ...row }));
    rerender(<DashboardPage shellUrl="https://example.test" />);
    expect(screen.getAllByTestId(/cell-error-/)).toHaveLength(2);
  });

  it("preserves strict validation in the shared model", () => {
    expect(() =>
      buildCellModel(new Map(), {
        slug: "agno",
        featureId: "bad/feature",
        isSupported: true,
        isWired: true,
      }),
    ).toThrow("featureId must not contain");
  });
});
