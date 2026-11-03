import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildA2UICatalogContextValue,
  extractA2UICatalogSchemas,
  serializeA2UISchema,
} from "../a2ui-catalog-schema";
import type { A2UICatalogSchemaSource } from "../a2ui-catalog-schema";

function catalog(
  components: Record<string, z.ZodTypeAny>,
  extra: Partial<A2UICatalogSchemaSource> = {},
): A2UICatalogSchemaSource {
  return {
    id: "copilotkit://test",
    components: new Map(
      Object.entries(components).map(([name, schema]) => [name, { schema }]),
    ),
    ...extra,
  };
}

function props(
  schema: ReturnType<typeof extractA2UICatalogSchemas>,
  name: string,
) {
  const allOf = schema.components[name].allOf as {
    properties: Record<string, Record<string, unknown>>;
  }[];
  return allOf[1].properties;
}

function commonTypes(schema: ReturnType<typeof extractA2UICatalogSchemas>) {
  return schema["common_types.json"]?.$defs ?? {};
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractA2UICatalogSchemas", () => {
  it("replaces a REF marker with a bare $ref and stores its shape once", () => {
    const action = () =>
      z
        .object({ event: z.object({ name: z.string() }) })
        .describe("REF:common_types.json#/$defs/Action|Click action");
    const schema = extractA2UICatalogSchemas(
      catalog({
        Button: z.object({
          action: action(),
          child: z
            .string()
            .describe("REF:common_types.json#/$defs/ComponentId"),
        }),
        Link: z.object({ action: action() }),
      }),
    );

    expect(props(schema, "Button").action).toEqual({
      $ref: "common_types.json#/$defs/Action",
      description: "Click action",
    });
    expect(props(schema, "Link").action).toEqual(
      props(schema, "Button").action,
    );
    expect(props(schema, "Button").child).toEqual({
      $ref: "common_types.json#/$defs/ComponentId",
    });
    expect(commonTypes(schema)).toEqual({
      Action: {
        type: "object",
        properties: {
          event: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
        required: ["event"],
        additionalProperties: false,
      },
      ComponentId: { type: "string" },
    });
    expect(JSON.stringify(schema)).not.toContain("REF:");
  });

  it("omits the common types block when nothing references one", () => {
    const schema = extractA2UICatalogSchemas(
      catalog({ Text: z.object({ text: z.string() }) }),
    );

    expect(schema).not.toHaveProperty(["common_types.json"]);
  });

  it("keeps a use whose shape differs from the stored type inline", () => {
    const schema = extractA2UICatalogSchemas(
      catalog({
        Text: z.object({
          text: z
            .union([z.string(), z.object({ path: z.string() })])
            .describe("REF:common_types.json#/$defs/DynamicString"),
        }),
        Badge: z.object({
          label: z
            .string()
            .describe("REF:common_types.json#/$defs/DynamicString|Label"),
        }),
      }),
    );

    expect(props(schema, "Text").text).toEqual({
      $ref: "common_types.json#/$defs/DynamicString",
    });
    expect(props(schema, "Badge").label).toEqual({
      $ref: "common_types.json#/$defs/DynamicString",
      description: "Label",
      type: "string",
    });
    expect(commonTypes(schema).DynamicString).toMatchObject({
      anyOf: [{ type: "string" }, { type: "object" }],
    });
  });

  it("stores nested common types by bare $ref too", () => {
    const dynamicString = z
      .union([z.string(), z.object({ path: z.string() })])
      .describe("REF:common_types.json#/$defs/DynamicString");
    const schema = extractA2UICatalogSchemas(
      catalog({
        Card: z.object({
          action: z
            .object({ label: dynamicString })
            .describe("REF:common_types.json#/$defs/Action"),
        }),
      }),
    );

    expect(props(schema, "Card").action).toEqual({
      $ref: "common_types.json#/$defs/Action",
    });
    expect(commonTypes(schema).Action).toMatchObject({
      properties: {
        label: { $ref: "common_types.json#/$defs/DynamicString" },
      },
    });
    expect(commonTypes(schema).DynamicString).toMatchObject({
      anyOf: [{ type: "string" }, { properties: { path: { type: "string" } } }],
    });
  });

  it("keeps the full description text after the first |", () => {
    const schema = extractA2UICatalogSchemas(
      catalog({
        Badge: z.object({
          status: z
            .string()
            .describe(
              "REF:common_types.json#/$defs/DynamicString|Shown when status is 'open' | 'closed'",
            ),
        }),
      }),
    );

    expect(props(schema, "Badge").status.description).toBe(
      "Shown when status is 'open' | 'closed'",
    );
  });

  it("does not rewrite or mutate literal default values", () => {
    const fallback = { description: "REF:common_types.json#/$defs/Action|x" };
    const schema = extractA2UICatalogSchemas(
      catalog({
        Widget: z.object({
          meta: z.record(z.string(), z.string()).default(fallback),
        }),
      }),
    );

    expect(props(schema, "Widget").meta.default).toEqual({
      description: "REF:common_types.json#/$defs/Action|x",
    });
    expect(fallback).toEqual({
      description: "REF:common_types.json#/$defs/Action|x",
    });
  });

  it("still resolves REF markers on a property named default", () => {
    const schema = extractA2UICatalogSchemas(
      catalog({
        Picker: z.object({
          default: z
            .string()
            .describe("REF:common_types.json#/$defs/ComponentId"),
        }),
      }),
    );

    expect(props(schema, "Picker").default.$ref).toBe(
      "common_types.json#/$defs/ComponentId",
    );
  });

  it("inlines reused schemas so no local $ref is left dangling", () => {
    const label = z.string().describe("Label text");
    const theme = z.object({
      heading: z
        .object({ font: label })
        .describe("REF:common_types.json#/$defs/Typography"),
      body: z.object({ font: label }),
    });
    const schema = extractA2UICatalogSchemas(
      catalog(
        {
          Header: z.object({ title: label, subtitle: label }),
        },
        { themeSchema: theme },
      ),
    );

    expect(JSON.stringify(schema)).not.toContain('"$ref":"#/');
    expect(props(schema, "Header").subtitle).toEqual({
      type: "string",
      description: "Label text",
    });
    expect(schema.theme?.body).toMatchObject({
      properties: { font: { type: "string" } },
    });
    expect(schema.theme?.heading).toEqual({
      $ref: "common_types.json#/$defs/Typography",
    });
    expect(commonTypes(schema).Typography).toMatchObject({
      properties: { font: { type: "string", description: "Label text" } },
    });
  });

  it("turns a recursive reference into an any schema without warning", () => {
    interface TreeNode {
      label: string;
      children?: TreeNode[];
    }
    const treeNode: z.ZodType<TreeNode> = z.lazy(() =>
      z.object({ label: z.string(), children: z.array(treeNode).optional() }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const schema = extractA2UICatalogSchemas(
      catalog({ Tree: z.object({ root: treeNode }) }),
    );

    expect(props(schema, "Tree").root).toMatchObject({
      type: "object",
      properties: {
        label: { type: "string" },
        children: { type: "array", items: {} },
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a component named __proto__ as a regular entry", () => {
    const schema = extractA2UICatalogSchemas({
      id: "copilotkit://test",
      components: new Map([
        ["__proto__", { schema: z.object({ text: z.string() }) }],
      ]),
    });

    expect(Object.keys(schema.components)).toEqual(["__proto__"]);
    expect(JSON.parse(JSON.stringify(schema)).components).toHaveProperty(
      "__proto__",
    );
  });

  it("does not throw on default values structuredClone cannot copy", () => {
    const schema = extractA2UICatalogSchemas(
      catalog({
        Widget: z.object({
          meta: z
            .object({ label: z.string() })
            .passthrough()
            .default({ label: "x", onClick: () => {} } as { label: string }),
        }),
      }),
    );

    expect(props(schema, "Widget").meta.default).toEqual({ label: "x" });
  });

  it("keeps a component's root description", () => {
    const schema = extractA2UICatalogSchemas(
      catalog({
        FlightCard: z
          .object({ airline: z.string() })
          .describe("Shows one flight"),
      }),
    );

    expect(schema.components.FlightCard.description).toBe("Shows one flight");
  });

  it("exports functions with REF-stripped root descriptions and no $schema", () => {
    const schema = extractA2UICatalogSchemas(
      catalog(
        {},
        {
          functions: new Map([
            [
              "format",
              {
                name: "format",
                returnType: "string",
                schema: z
                  .object({ value: z.string() })
                  .describe(
                    "REF:common_types.json#/$defs/FunctionCall|Formats a value",
                  ),
              },
            ],
          ]),
        },
      ),
    );

    expect(schema.functions).toEqual([
      {
        name: "format",
        description: "Formats a value",
        returnType: "string",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ]);
  });

  it("tolerates catalog-shaped objects with non-Map or partial functions", () => {
    const fn = {
      name: "upper",
      returnType: "string",
      schema: z.object({ value: z.string() }),
    };

    for (const functions of [
      undefined,
      { upper: fn },
      [fn, { name: "broken" }, null],
    ]) {
      const schema = extractA2UICatalogSchemas(
        catalog({ Text: z.object({ text: z.string() }) }, { functions }),
      );
      expect(schema.functions?.map((f) => f.name)).toEqual(
        functions ? ["upper"] : undefined,
      );
    }
  });
});

describe("serializeA2UISchema", () => {
  it("returns an independent copy on every call", () => {
    const zodSchema = z.object({ name: z.string() });

    const first = serializeA2UISchema(zodSchema);
    (first.properties as Record<string, unknown>).name = "mutated";

    expect(serializeA2UISchema(zodSchema)).toMatchObject({
      properties: { name: { type: "string" } },
    });
  });
});

describe("buildA2UICatalogContextValue", () => {
  it("describes custom components with the same REF handling as the schema", () => {
    const value = buildA2UICatalogContextValue(
      catalog({
        Text: z.object({ text: z.string() }),
        Card: z.object({
          child: z
            .string()
            .describe("REF:common_types.json#/$defs/ComponentId|Card body"),
        }),
      }),
      new Set(["Text", "Image"]),
    );

    expect(value).toContain(
      "  Custom catalog (does NOT include all basic components).",
    );
    expect(value).toContain("  - Card:");
    expect(value).not.toContain("  - Text:");
    expect(value).toContain('"$ref": "common_types.json#/$defs/ComponentId"');
    expect(value).toContain('"description": "Card body"');
    expect(value).toContain(
      "  Common types referenced above (common_types.json#/$defs):",
    );
    expect(value).toContain('"ComponentId": {');
    expect(value).toContain('"type": "string"');
    expect(value).not.toContain("REF:");
  });
});
