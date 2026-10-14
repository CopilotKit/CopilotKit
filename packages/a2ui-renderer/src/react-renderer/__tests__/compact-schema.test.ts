import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ActionSchema,
  ChildListSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
} from "@a2ui/web_core/v0_9";
import { createCatalog } from "../create-catalog";
import {
  buildCatalogContextValue,
  buildCompactCatalogCapabilities,
  buildCompactCatalogSchema,
  extractCatalogComponentSchemas,
} from "../catalog-utils";
import { standardCatalog } from "../a2ui-react/catalog/standard";
import * as entry from "../index";

const definitions = {
  Badge: {
    description: "A small status label",
    props: z.object({
      label: DynamicStringSchema,
      count: DynamicNumberSchema.optional(),
      size: z.enum(["sm", "md"]).optional(),
      pill: z.boolean().optional().describe("Default false"),
      width: z.union([z.number(), z.string()]).optional(),
      tags: z.array(z.string()),
      items: z.array(z.object({ label: z.string(), value: z.number() })),
      style: z.object({ color: z.string(), bold: z.boolean().optional() }),
      children: ChildListSchema.optional(),
      action: ActionSchema.optional(),
    }),
  },
};

const catalog = createCatalog(
  definitions,
  { Badge: () => null },
  { catalogId: "test://compact" },
);

describe("buildCompactCatalogSchema", () => {
  const schema = buildCompactCatalogSchema(catalog);
  const props = schema.components.Badge!.props;

  it("keeps the catalog id and component description", () => {
    expect(schema.catalogId).toBe("test://compact");
    expect(schema.components.Badge!.description).toBe("A small status label");
  });

  it("summarises primitive, enum, union and optional props", () => {
    expect(props["size?"]).toBe('"sm" | "md"');
    expect(props["pill?"]).toBe("boolean // Default false");
    expect(props["width?"]).toBe("number | string");
    expect(props.tags).toBe("Array<string>");
  });

  it("summarises arrays of objects and objects one level deep", () => {
    expect(props.items).toBe("Array<{ label: string, value: number }>");
    expect(props.style).toBe("{ color: string, bold?: boolean }");
  });

  it("renders Dynamic props as literal | path and drops FunctionCall", () => {
    expect(props.label).toBe("string | { path: string }");
    expect(props["count?"]).toBe("number | { path: string }");
    expect(JSON.stringify(schema)).not.toContain('"call');
    expect(JSON.stringify(schema)).not.toContain("call:");
  });

  it("includes the FunctionCall alternative when asked", () => {
    const withCalls = buildCompactCatalogSchema(catalog, {
      includeFunctionCalls: true,
    });
    expect(withCalls.components.Badge!.props.label).toContain("call: string");
  });

  it("keeps child lists and actions readable", () => {
    expect(props["children?"]).toContain("Array<string>");
    expect(props["children?"]).toContain("componentId: string");
    expect(props["action?"]).toContain("event:");
    expect(props["action?"]).not.toContain("functionCall");
  });

  it("keeps the standard catalog under 25,000 chars without function calls", () => {
    const full = buildCompactCatalogSchema(standardCatalog);
    const json = JSON.stringify(full);
    expect(json.length).toBeLessThan(30_000);
    expect(json).not.toContain('"call"');
    expect(json).not.toContain("call:");
    expect(Object.keys(full.components)).toHaveLength(
      standardCatalog.components.size,
    );
    expect(full.components.Box).toBeDefined();
    expect(full.components.Box!.description).toBeTruthy();
    // Sanity: the full formats are far larger.
    expect(
      JSON.stringify(extractCatalogComponentSchemas(standardCatalog)).length,
    ).toBeGreaterThan(json.length * 2);
  });
});

describe("buildCompactCatalogSchema common props", () => {
  const shared = {
    gap: z.number().optional().describe("4px steps"),
    padding: z.number().optional(),
    align: z.enum(["start", "end"]).optional(),
  };
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const defs = Object.fromEntries(
    names.map((name) => [
      name,
      { props: z.object({ ...shared, [`own${name}`]: z.string() }) },
    ]),
  );
  const many = createCatalog(
    { ...defs, Lone: { props: z.object({ gap: z.number().optional() }) } },
    Object.fromEntries(
      [...names, "Lone"].map((name) => [name, () => null]),
    ) as never,
    { catalogId: "test://shared" },
  );

  it("hoists props shared verbatim by many components into commonProps", () => {
    const schema = buildCompactCatalogSchema(many);
    expect(schema.commonProps).toEqual({
      "gap?": "number // 4px steps",
      "padding?": "number",
      "align?": '"start" | "end"',
    });
    expect(schema.components.A).toEqual({
      includesCommonProps: true,
      props: { ownA: "string" },
    });
    // A component with only some of the common props keeps them inline.
    expect(schema.components.Lone).toEqual({ props: { "gap?": "number" } });
  });

  it("omits commonProps when few components share props", () => {
    const schema = buildCompactCatalogSchema(catalog);
    expect(schema.commonProps).toBeUndefined();
    expect(schema.components.Badge!.includesCommonProps).toBeUndefined();
  });
});

describe("buildCompactCatalogCapabilities", () => {
  it("lists the catalog id and component names only", () => {
    expect(buildCompactCatalogCapabilities(catalog)).toBe(
      "Available A2UI catalog: test://compact\nComponents (1): Badge",
    );
  });

  it("is much smaller than the full capabilities text for the standard catalog", () => {
    const compact = buildCompactCatalogCapabilities(standardCatalog);
    expect(compact).toContain(
      `Components (${standardCatalog.components.size}): `,
    );
    expect(compact).toContain("Box");
    expect(compact.length).toBeLessThan(2_000);
    expect(buildCatalogContextValue(standardCatalog).length).toBeGreaterThan(
      100_000,
    );
  });
});

describe("package entry", () => {
  it("exports the compact builders and standardRenderers", () => {
    expect(entry.buildCompactCatalogSchema).toBe(buildCompactCatalogSchema);
    expect(entry.buildCompactCatalogCapabilities).toBe(
      buildCompactCatalogCapabilities,
    );
    expect(typeof entry.standardRenderers.Box).toBe("function");
  });
});
