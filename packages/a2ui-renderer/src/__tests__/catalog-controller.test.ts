import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Catalog } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { CopilotKitCore } from "@copilotkit/core";
import { A2UICatalogController } from "../catalog-controller";
import {
  A2UI_CAPABILITIES_CONTEXT_DESCRIPTION,
  buildA2UIContextEntries,
} from "../catalog-context";
import { A2UI_SCHEMA_CONTEXT_DESCRIPTION } from "../catalog-description";
import { filterCatalog } from "../filter-catalog";

const CATALOG_ID = "copilotkit://custom";

function makeCatalog() {
  return new Catalog<ComponentApi>(CATALOG_ID, [
    { name: "FlightCard", schema: z.object({ airline: z.string() }) },
    { name: "Badge", schema: z.object({ text: z.string() }) },
  ]);
}

/** A catalog subclass with an extra field, like Angular's catalogs. */
class SurfaceCatalog extends Catalog<ComponentApi> {
  readonly surfaceComponent = "surface";
}

function contextDescriptions(core: CopilotKitCore) {
  return Object.values(core.context).map((entry) => entry.description);
}

function capabilities(core: CopilotKitCore) {
  return Object.values(core.context).find(
    (entry) => entry.description === A2UI_CAPABILITIES_CONTEXT_DESCRIPTION,
  );
}

describe("buildA2UIContextEntries", () => {
  it("sends four entries, or only the capabilities without schemas", () => {
    expect(buildA2UIContextEntries(makeCatalog())).toHaveLength(4);
    const [only, ...rest] = buildA2UIContextEntries(makeCatalog(), {
      includeSchema: false,
    });
    expect(rest).toEqual([]);
    expect(only!.value.split("\n")).toContain("  - Badge");
  });

  it("scopes every entry to the given agents", () => {
    const entries = buildA2UIContextEntries(makeCatalog(), {
      agentIds: ["chat"],
    });
    expect(entries.map((entry) => entry.agentIds)).toEqual([
      ["chat"],
      ["chat"],
      ["chat"],
      ["chat"],
    ]);
  });
});

describe("filterCatalog", () => {
  it("keeps the class and extra fields of a catalog subclass", () => {
    const catalog = new SurfaceCatalog(CATALOG_ID, [
      { name: "Badge", schema: z.object({}) },
    ]);
    const filtered = filterCatalog(catalog, () => false);
    expect(filtered).toBeInstanceOf(SurfaceCatalog);
    expect(filtered.surfaceComponent).toBe("surface");
    expect(filtered.components.size).toBe(0);
  });
});

describe("A2UICatalogController", () => {
  const defaultCatalog = new Catalog<ComponentApi>("basic", []);
  let created: A2UICatalogController<Catalog<ComponentApi>> | undefined;

  afterEach(() => {
    created?.dispose();
    vi.unstubAllGlobals();
  });

  function create(core = new CopilotKitCore({})) {
    created = new A2UICatalogController(core, defaultCatalog);
    return { core, controller: created };
  }

  it("registers the catalog's components with core", () => {
    const { core, controller } = create();
    controller.update({ enabled: false, catalog: makeCatalog() });
    expect(core.catalogComponents.map((component) => component.name)).toEqual([
      "FlightCard",
      "Badge",
    ]);
  });

  it("removes a component disabled in core from the catalog and the context", () => {
    const { core, controller } = create();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.update({ enabled: true, catalog: makeCatalog() });

    core.setCatalogComponentEnabled("Badge", false);

    expect([...controller.getSnapshot()!.components.keys()]).toEqual([
      "FlightCard",
    ]);
    expect(listener).toHaveBeenCalled();
    expect(capabilities(core)?.value).not.toContain("Badge");
  });

  it("registers the context only while enabled, without schemas when asked", () => {
    const { core, controller } = create();
    controller.update({ enabled: false, catalog: makeCatalog() });
    expect(contextDescriptions(core)).toEqual([]);

    controller.update({
      enabled: true,
      catalog: makeCatalog(),
      includeSchema: false,
    });
    expect(contextDescriptions(core)).toEqual([
      A2UI_CAPABILITIES_CONTEXT_DESCRIPTION,
    ]);

    controller.update({ enabled: true, catalog: makeCatalog() });
    expect(contextDescriptions(core)).toContain(
      A2UI_SCHEMA_CONTEXT_DESCRIPTION,
    );
    expect(contextDescriptions(core)).toHaveLength(4);

    controller.dispose();
    expect(contextDescriptions(core)).toEqual([]);

    // A remount reuses the controller.
    controller.update({ enabled: true, catalog: makeCatalog() });
    expect(contextDescriptions(core)).toHaveLength(4);
  });

  it("describes the default catalog when none is passed", () => {
    const { core, controller } = create();
    controller.update({ enabled: true, catalog: undefined });
    expect(capabilities(core)?.value).toContain("- basic");
  });

  it("scopes the context to the runtime's A2UI agents once they are known", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: "1.0.0",
          agents: { chat: { description: "", capabilities: {} } },
          a2ui: { enabled: true, agents: ["chat"] },
        }),
      }),
    );
    const { core, controller } = create(
      new CopilotKitCore({ runtimeUrl: "https://runtime.example" }),
    );
    controller.update({ enabled: true, catalog: makeCatalog() });

    await vi.waitFor(() =>
      expect(capabilities(core)?.agentIds).toEqual(["chat"]),
    );
  });
});
