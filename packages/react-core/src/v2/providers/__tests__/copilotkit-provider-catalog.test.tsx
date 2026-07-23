import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { z } from "zod";
import { Catalog } from "@copilotkit/a2ui-renderer";

// `@a2ui/web_core` is not a direct dependency of react-core, so we mirror the
// minimal `ComponentApi` shape the built catalog carries locally (schema is a
// Zod schema, matching the real `ComponentApi` constraint on `Catalog<T>`).
type ComponentApi = { name: string; schema: z.ZodType<any> };

// Capture the catalog handed to the render path. The provider imports
// `createA2UIMessageRenderer` from `../a2ui/A2UIMessageRenderer` (not from the
// package), so that is the module to stub.
const rendererCatalogs: Array<Catalog<ComponentApi> | undefined> = [];
vi.mock("../../a2ui/A2UIMessageRenderer", () => ({
  createA2UIMessageRenderer: (opts: { catalog?: Catalog<ComponentApi> }) => {
    rendererCatalogs.push(opts?.catalog);
    return {
      activityType: "a2ui-surface",
      content: z.object({}),
      render: () => null,
    };
  },
}));

// Capture the catalog handed to the advertisement path.
const contextCatalogs: Array<Catalog<ComponentApi> | undefined> = [];
vi.mock("../../a2ui/A2UICatalogContext", () => ({
  A2UICatalogContext: ({ catalog }: { catalog?: Catalog<ComponentApi> }) => {
    contextCatalogs.push(catalog);
    return null;
  },
}));

import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import type { CopilotKitCore } from "@copilotkit/core";

function makeCatalog(): Catalog<ComponentApi> {
  const components: ComponentApi[] = [
    {
      name: "PieChart",
      schema: z.object({ innerRadius: z.number().optional() }),
    },
    { name: "FlightCard", schema: z.object({ airline: z.string() }) },
    { name: "Badge", schema: z.object({ text: z.string() }) },
  ];
  return new Catalog<ComponentApi>(
    "copilotkit://custom-catalog",
    components,
    [],
  );
}

let capturedCore: CopilotKitCore | null = null;
function CoreCapture() {
  const { copilotkit } = useCopilotKit();
  capturedCore = copilotkit;
  return null;
}

describe("CopilotKitProvider A2UI catalog toggling", () => {
  beforeEach(() => {
    rendererCatalogs.length = 0;
    contextCatalogs.length = 0;
    capturedCore = null;
  });

  it("registers all catalog components onto core", () => {
    render(
      <CopilotKitProvider a2ui={{ catalog: makeCatalog() }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    expect(capturedCore!.catalogComponents.map((c) => c.name).sort()).toEqual([
      "Badge",
      "FlightCard",
      "PieChart",
    ]);
  });

  it("passes the FULL catalog to both paths when nothing is disabled", () => {
    render(
      <CopilotKitProvider a2ui={{ catalog: makeCatalog() }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    const lastRenderer = rendererCatalogs.at(-1)!;
    const lastContext = contextCatalogs.at(-1)!;
    expect(lastRenderer.components.has("FlightCard")).toBe(true);
    expect(lastContext.components.has("FlightCard")).toBe(true);
  });

  it("removes a disabled component from BOTH the render and advertisement catalogs", () => {
    render(
      <CopilotKitProvider a2ui={{ catalog: makeCatalog() }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    act(() => {
      capturedCore!.setCatalogComponentEnabled("FlightCard", false);
    });
    const lastRenderer = rendererCatalogs.at(-1)!;
    const lastContext = contextCatalogs.at(-1)!;
    expect(lastRenderer.components.has("FlightCard")).toBe(false);
    expect(lastRenderer.components.has("PieChart")).toBe(true);
    expect(lastContext.components.has("FlightCard")).toBe(false);
    expect(lastContext.components.has("PieChart")).toBe(true);
  });

  it("does not register components when no catalog is provided", () => {
    render(
      <CopilotKitProvider>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    expect(capturedCore!.catalogComponents).toHaveLength(0);
  });

  it("does not throw or register components for a non-Catalog catalog object", () => {
    // A catalog-shaped object that is NOT a real `Catalog` instance, carrying a
    // component in its Map. The `filteredCatalog` memo passes such objects
    // through UNFILTERED, so the registration effect must ALSO skip it —
    // otherwise "Widget" would become toggleable in the inspector while
    // disabling never removes it (silent enforcement divergence). It must also
    // not throw at mount when `.components` isn't a real catalog Map (a plain
    // object would throw on `.values()` before the guard).
    const nonCatalog = {
      components: new Map([
        ["Widget", { name: "Widget", schema: z.object({}) }],
      ]),
    };
    expect(() =>
      render(
        <CopilotKitProvider a2ui={{ catalog: nonCatalog as any }}>
          <CoreCapture />
        </CopilotKitProvider>,
      ),
    ).not.toThrow();
    // Nothing registered: not a genuine `Catalog`, so it is neither toggleable
    // nor filtered — consistent with `filteredCatalog` passing it through.
    expect(capturedCore!.catalogComponents).toHaveLength(0);
  });

  it("re-enabling a component restores it on both paths", () => {
    render(
      <CopilotKitProvider a2ui={{ catalog: makeCatalog() }}>
        <CoreCapture />
      </CopilotKitProvider>,
    );
    act(() => {
      capturedCore!.setCatalogComponentEnabled("FlightCard", false);
    });
    act(() => {
      capturedCore!.setCatalogComponentEnabled("FlightCard", true);
    });
    const lastRenderer = rendererCatalogs.at(-1)!;
    const lastContext = contextCatalogs.at(-1)!;
    expect(lastRenderer.components.has("FlightCard")).toBe(true);
    expect(lastContext.components.has("FlightCard")).toBe(true);
  });
});
