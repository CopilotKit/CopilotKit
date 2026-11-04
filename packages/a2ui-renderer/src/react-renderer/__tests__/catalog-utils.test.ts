import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import {
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "../catalog-utils";
import { basicCatalog } from "../a2ui-react";

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

    expect(value).toContain("- copilotkit://custom-catalog");
    expect(value).toContain("  - FlightCard");
    expect(value).toContain("  - PieChart");
    expect(value).not.toContain('"airline"');
    expect(value).not.toContain('"innerRadius"');
    expect(value).not.toContain('"type"');
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

  it("describes the basic catalog the same way regardless of includeSchema", () => {
    expect(
      buildCatalogContextValue(basicCatalog, { includeSchema: false }),
    ).toBe(buildCatalogContextValue(basicCatalog));
  });
});

/**
 * Upstream's inline catalog, minus the differences we make on purpose: no
 * `$schema` or duplicated description in function parameters, and absent
 * rather than undefined `functions`/`theme`. Compared with toMatchObject,
 * since we also add the `common_types.json` block.
 */
function upstreamInlineCatalog(catalog: Catalog<ComponentApi>) {
  const canonical = new MessageProcessor([catalog]).getClientCapabilities({
    includeInlineCatalogs: true,
  })["v0.9"].inlineCatalogs![0];
  const { functions, theme, ...rest } = canonical;
  return {
    ...rest,
    ...(theme ? { theme } : {}),
    ...(functions
      ? {
          functions: functions.map((fn) => {
            const {
              $schema: _schema,
              description: _description,
              ...parameters
            } = fn.parameters as Record<string, unknown>;
            return { ...fn, parameters };
          }),
        }
      : {}),
  };
}

describe("extractCatalogComponentSchemas", () => {
  it("supports component-only legacy catalogs without function metadata", () => {
    const catalog = makeCustomCatalog();
    Reflect.deleteProperty(catalog, "functions");

    const schema = extractCatalogComponentSchemas(catalog);

    expect(schema.catalogId).toBe(catalog.id);
    expect(Object.keys(schema.components)).toEqual(["FlightCard", "PieChart"]);
    expect(schema.functions).toBeUndefined();
    expect(schema.theme).toBeUndefined();
  });

  it("exports component reference markers as $refs with one copy of each type, preserving property order", () => {
    const catalog = new Catalog<ComponentApi>("copilotkit://composed", [
      {
        name: "Card",
        schema: z.object({
          title: z.string(),
          subtitle: z.string().optional(),
          child: z
            .string()
            .describe("REF:common_types.json#/$defs/ComponentId|Card content"),
        }),
      },
      {
        name: "Column",
        schema: z.object({
          children: z
            .array(z.string())
            .describe("REF:common_types.json#/$defs/ChildList"),
          action: z
            .object({ event: z.string() })
            .describe("REF:common_types.json#/$defs/Action|Click action"),
        }),
      },
    ]);

    const schema = extractCatalogComponentSchemas(catalog);
    expect(schema.catalogId).toBe(catalog.id);
    expect(schema.components.Card).toEqual({
      allOf: [
        { $ref: "common_types.json#/$defs/ComponentCommon" },
        {
          properties: {
            component: { const: "Card" },
            title: { type: "string" },
            subtitle: { type: "string" },
            child: {
              $ref: "common_types.json#/$defs/ComponentId",
              description: "Card content",
            },
          },
          required: ["component", "title", "child"],
        },
      ],
    });
    expect(schema.components.Column).toMatchObject({
      allOf: [
        {},
        {
          properties: {
            children: { $ref: "common_types.json#/$defs/ChildList" },
            action: {
              $ref: "common_types.json#/$defs/Action",
              description: "Click action",
            },
          },
        },
      ],
    });
    expect(schema).toMatchObject(upstreamInlineCatalog(catalog));
    expect(schema["common_types.json"]?.$defs).toEqual({
      ComponentId: { type: "string" },
      ChildList: { type: "array", items: { type: "string" } },
      Action: {
        type: "object",
        properties: { event: { type: "string" } },
        required: ["event"],
        additionalProperties: false,
      },
    });
    const card = schema.components.Card.allOf as {
      properties?: Record<string, unknown>;
    }[];
    expect(Object.keys(card[1].properties!)).toEqual([
      "component",
      "title",
      "subtitle",
      "child",
    ]);
  });

  it("exports function and theme schemas in the upstream capability format", () => {
    const catalog = new Catalog<ComponentApi>(
      "copilotkit://themed",
      [],
      [
        {
          name: "format",
          returnType: "string",
          schema: z
            .object({
              value: z
                .string()
                .describe(
                  "REF:common_types.json#/$defs/DynamicString|Value to format",
                ),
            })
            .describe("Formats a value"),
          execute: () => "formatted",
        },
      ],
      z.object({
        primaryColor: z
          .string()
          .describe("REF:common_types.json#/$defs/Color|Main color"),
      }),
    );
    const schema = extractCatalogComponentSchemas(catalog);
    expect(schema).toMatchObject(upstreamInlineCatalog(catalog));
    expect(schema.functions?.[0]?.parameters).not.toHaveProperty("$schema");
  });

  it("inlines reused Zod schemas so no local $ref is left dangling", () => {
    const schema = extractCatalogComponentSchemas();

    // Text/Image/TextField reuse DynamicString internals from accessibility.label.
    // Those references would point into a subtree replaced by AccessibilityAttributes.
    expect(JSON.stringify(schema)).not.toContain('"$ref":"#/');
    expect(schema.components.Text).toMatchObject({
      allOf: [
        {},
        {
          properties: {
            accessibility: {
              $ref: "common_types.json#/$defs/AccessibilityAttributes",
            },
            text: {
              anyOf: [
                { type: "string" },
                { $ref: "common_types.json#/$defs/DataBinding" },
                { $ref: "common_types.json#/$defs/FunctionCall" },
              ],
            },
          },
        },
      ],
    });
    expect(schema.components.Column).toMatchObject({
      allOf: [
        {},
        {
          properties: {
            children: {
              anyOf: [
                {},
                {
                  properties: {
                    componentId: {
                      $ref: "common_types.json#/$defs/ComponentId",
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    });
  });
});
