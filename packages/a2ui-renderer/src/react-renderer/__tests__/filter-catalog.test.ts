import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Catalog, createFunctionImplementation } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { filterCatalog } from "../filter-catalog";

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

describe("filterCatalog", () => {
  it("keeps only components whose name passes the predicate", () => {
    const catalog = makeCatalog();
    const filtered = filterCatalog(catalog, (name) => name !== "FlightCard");
    expect(filtered.components.has("PieChart")).toBe(true);
    expect(filtered.components.has("Badge")).toBe(true);
    expect(filtered.components.has("FlightCard")).toBe(false);
  });

  it("preserves the catalog id and functions", () => {
    const catalog = makeCatalog();
    const filtered = filterCatalog(catalog, () => true);
    expect(filtered.id).toBe("copilotkit://custom-catalog");
    expect(filtered.components.size).toBe(3);
  });

  it("preserves themeSchema and real functions when narrowing components", () => {
    const themeSchema = z.object({
      primaryColor: z.string(),
      radius: z.number().optional(),
    });
    const uppercase = createFunctionImplementation(
      {
        name: "uppercase",
        returnType: "string",
        schema: z.object({ value: z.string() }),
      },
      (args) => args.value.toUpperCase(),
    );
    const components: ComponentApi[] = [
      {
        name: "PieChart",
        schema: z.object({ innerRadius: z.number().optional() }),
      },
      { name: "Badge", schema: z.object({ text: z.string() }) },
    ];
    const catalog = new Catalog<ComponentApi>(
      "copilotkit://themed-catalog",
      components,
      [uppercase],
      themeSchema,
    );

    const filtered = filterCatalog(catalog, (name) => name === "Badge");

    // component set narrowed
    expect(filtered.components.has("Badge")).toBe(true);
    expect(filtered.components.has("PieChart")).toBe(false);
    // themeSchema is the exact same schema instance (not dropped)
    expect(filtered.themeSchema).toBe(themeSchema);
    // functions are preserved
    expect(filtered.functions.has("uppercase")).toBe(true);
    expect(filtered.functions.get("uppercase")).toBe(uppercase);
  });

  it("does not mutate the source catalog", () => {
    const catalog = makeCatalog();
    filterCatalog(catalog, () => false);
    expect(catalog.components.size).toBe(3);
  });

  it("returns an empty-component catalog when predicate rejects all", () => {
    const catalog = makeCatalog();
    const filtered = filterCatalog(catalog, () => false);
    expect(filtered.components.size).toBe(0);
    expect(filtered.id).toBe("copilotkit://custom-catalog");
  });
});

describe("filterCatalog package export", () => {
  it("is exported from the package entry", async () => {
    const mod = await import("@copilotkit/a2ui-renderer");
    expect(typeof (mod as { filterCatalog?: unknown }).filterCatalog).toBe(
      "function",
    );
  });
});
