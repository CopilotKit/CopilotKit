import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { UnifiedCell } from "../unified-cell";
import { buildCellModel } from "@/lib/cell-model";
import type { Overlay } from "@/lib/overlay-types";
import type { CellContext } from "../feature-grid";

vi.mock("@/lib/docs-status", () => ({
  getDocsStatus: () => ({ og: "ok", shell: "ok" }),
}));
vi.mock("@/hooks/useLastTransition", () => ({
  useLastTransition: () => ({ row: null, loaded: false, error: null }),
  deriveFromTo: () => ({ from: null, to: null }),
}));

function makeCtx(): CellContext {
  const demo = {
    id: "agentic-chat",
    name: "Agentic Chat",
    description: "Chat",
    tags: [],
    route: "/agentic-chat",
  };
  return {
    integration: {
      name: "Agno",
      slug: "agno",
      category: "framework",
      language: "Python",
      description: "Agno",
      repo: "https://example.test/repo",
      backend_url: "https://example.test",
      deployed: true,
      features: [demo.id],
      demos: [demo],
    },
    feature: {
      id: demo.id,
      name: demo.name,
      category: "chat-ui",
      description: "Chat",
      kind: "primary",
    },
    demo,
    hostedUrl: "https://example.test/chat",
    shellUrl: "https://example.test",
    liveStatus: new Map(),
    connection: "live",
  };
}

function mount(overlays: Overlay[], ctx = makeCtx()) {
  const model = buildCellModel(ctx.liveStatus, {
    slug: ctx.integration.slug,
    featureId: ctx.feature.id,
    isSupported: true,
    isWired: true,
  });
  return render(
    <UnifiedCell ctx={ctx} model={model} overlays={new Set(overlays)} />,
  );
}

describe("active cell overlay integration", () => {
  it.each<Overlay>(["links", "depth", "health", "docs", "parity"])(
    "%s shows only its own content",
    (overlay) => {
      const { queryByRole, queryByTestId, queryByText } = mount([overlay]);
      expect(Boolean(queryByRole("link", { name: /Demo/ }))).toBe(
        overlay === "links",
      );
      expect(Boolean(queryByRole("link", { name: /Code/ }))).toBe(
        overlay === "links",
      );
      expect(Boolean(queryByTestId("depth-layer"))).toBe(overlay === "depth");
      expect(Boolean(queryByTestId("health-layer"))).toBe(overlay === "health");
      expect(Boolean(queryByTestId("docs-layer"))).toBe(overlay === "docs");
      expect(Boolean(queryByText("docs-og"))).toBe(overlay === "docs");
      expect(Boolean(queryByText("docs-shell"))).toBe(overlay === "docs");
    },
  );

  it("combines links, depth, health, and docs when enabled together", () => {
    const { getByRole, getByTestId, getByText } = mount([
      "links",
      "depth",
      "health",
      "docs",
    ]);
    expect(getByRole("link", { name: /Demo/ })).toBeInTheDocument();
    expect(getByRole("link", { name: /Code/ })).toBeInTheDocument();
    for (const id of ["depth-layer", "health-layer"]) {
      expect(getByTestId(id)).toBeInTheDocument();
    }
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();
  });

  it("docs-only features retain links and docs without probe badges", () => {
    const ctx = makeCtx();
    ctx.feature = { ...ctx.feature, kind: "docs-only" };
    const { getByRole, getByText, queryByTestId } = mount(
      ["links", "depth", "health", "docs"],
      ctx,
    );
    expect(getByRole("link", { name: /Demo/ })).toBeInTheDocument();
    expect(getByText("docs-og")).toBeInTheDocument();
    expect(getByText("docs-shell")).toBeInTheDocument();
    expect(queryByTestId("depth-layer")).not.toBeInTheDocument();
    expect(queryByTestId("health-layer")).not.toBeInTheDocument();
  });
});
