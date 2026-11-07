import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Catalog } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { BASIC_COMPONENTS } from "@a2ui/web_core/v0_9/basic_catalog";
import {
  A2UI_BASIC_CATALOG_ID,
  buildCatalogContextValue,
} from "../a2ui-catalog-context";

function makeCustomCatalog(): Catalog<ComponentApi> {
  const components: ComponentApi[] = [
    { name: "FlightCard", schema: z.object({ airline: z.string() }) },
    {
      name: "PieChart",
      schema: z.object({ innerRadius: z.number().optional() }),
    },
  ];
  return new Catalog<ComponentApi>(
    "copilotkit://custom-catalog",
    components,
    [],
  );
}

describe("buildCatalogContextValue", () => {
  it("includes each custom component's JSON schema by default", () => {
    const value = buildCatalogContextValue(makeCustomCatalog());

    expect(value).toContain("- copilotkit://custom-catalog");
    expect(value).toContain("  - FlightCard:");
    expect(value).toContain('"airline"');
    expect(value).toContain('"innerRadius"');
  });

  it("includes schemas when includeSchema is true", () => {
    const catalog = makeCustomCatalog();

    expect(buildCatalogContextValue(catalog, { includeSchema: true })).toBe(
      buildCatalogContextValue(catalog),
    );
  });

  it("lists custom components by name only when includeSchema is false", () => {
    const value = buildCatalogContextValue(makeCustomCatalog(), {
      includeSchema: false,
    });

    expect(value).toBe(
      [
        "Available A2UI catalog:",
        "- copilotkit://custom-catalog",
        "  Custom catalog (does NOT include all basic components).",
        "  Custom components:",
        "  - FlightCard",
        "  - PieChart",
      ].join("\n"),
    );
  });

  it("lists only the custom names of a catalog that extends the basic one", () => {
    const catalog = new Catalog<ComponentApi>(
      "copilotkit://extended-catalog",
      [
        ...BASIC_COMPONENTS,
        { name: "FlightCard", schema: z.object({ airline: z.string() }) },
      ],
      [],
    );

    expect(buildCatalogContextValue(catalog, { includeSchema: false })).toBe(
      [
        "Available A2UI catalog:",
        "- copilotkit://extended-catalog",
        "  Extends the basic catalog with all standard components plus:",
        "  - FlightCard",
      ].join("\n"),
    );
  });

  it("describes the basic catalog the same way regardless of includeSchema", () => {
    const catalog = new Catalog<ComponentApi>(
      A2UI_BASIC_CATALOG_ID,
      BASIC_COMPONENTS,
      [],
    );

    expect(buildCatalogContextValue(catalog, { includeSchema: false })).toBe(
      buildCatalogContextValue(catalog),
    );
  });
});
