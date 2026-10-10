import { describe, expect, it } from "vitest";
import { z as z3 } from "zod";
import { catalogSchemaToJsonSchema } from "../catalog-schema";
import { extractCatalogComponentSchemas as extractReactCatalogSchemas } from "../react-renderer/catalog-utils";

/**
 * A schema shaped like Zod v4, without adding a second copy of Zod to the
 * workspace — an aliased `zod@4` devDependency re-resolves the `zod` peer of
 * unrelated packages (openai, the @ag-ui/* family) across the whole monorepo.
 *
 * Faithful in the two respects this conversion depends on: v4 renamed
 * `_def.typeName` to `_def.type`, which is the lookup `zodToJsonSchema` uses to
 * recognise a schema, and v4 implements Standard JSON Schema V1. Passing this to
 * `zodToJsonSchema` returns a bare `{ $schema }` — no `properties`, no
 * `required`, and no error — exactly as a real v4 schema does.
 */
function zodV4Like() {
  return {
    _def: { type: "object" },
    "~standard": {
      version: 1,
      vendor: "zod",
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => ({
          type: "object",
          properties: {
            filingId: { type: "string" },
            status: { type: "string" },
            risk: { type: "string" },
          },
          required: ["filingId", "status", "risk"],
        }),
      },
    },
  };
}

/**
 * `@copilotkit/react-core` accepts `zod >= 3.0.0` as a peer dependency, so an
 * application may legitimately build its A2UI catalog with Zod v4 while this
 * package pins Zod v3 for its own catalog. `zodToJsonSchema` understands v3
 * internals only and returns a bare `{ $schema }` for a v4 schema — no
 * `properties`, no `required`, and no error — which silently strips every prop
 * from the catalog the model is shown and leaves the surface unpaintable.
 */
describe("catalogSchemaToJsonSchema", () => {
  const shape = {
    filingId: "string",
    status: "string",
    risk: "string",
  } as const;

  it("converts a Zod v3 schema", () => {
    const converted = catalogSchemaToJsonSchema(
      z3.object({
        filingId: z3.string(),
        status: z3.string(),
        risk: z3.string(),
      }),
      { target: "jsonSchema2019-09" },
    ) as { properties?: Record<string, unknown>; required?: string[] };

    expect(Object.keys(converted.properties ?? {})).toEqual(Object.keys(shape));
    expect(converted.required).toEqual(Object.keys(shape));
  });

  it("converts a Zod v4 schema instead of silently dropping its props", () => {
    const converted = catalogSchemaToJsonSchema(zodV4Like(), {
      target: "jsonSchema2019-09",
    }) as { properties?: Record<string, unknown>; required?: string[] };

    expect(Object.keys(converted.properties ?? {})).toEqual(Object.keys(shape));
    expect(converted.required).toEqual(Object.keys(shape));
  });

  it("converts any Standard JSON Schema V1 implementation", () => {
    const jsonSchema = {
      type: "object",
      properties: { filingId: { type: "string" } },
      required: ["filingId"],
    };
    const standardSchema = {
      "~standard": {
        version: 1,
        vendor: "not-zod",
        validate: (value: unknown) => ({ value }),
        jsonSchema: { input: () => jsonSchema },
      },
    };

    expect(catalogSchemaToJsonSchema(standardSchema)).toEqual(jsonSchema);
  });

  it("throws rather than returning an empty schema for an unconvertible schema", () => {
    const opaque = {
      "~standard": {
        version: 1,
        vendor: "mystery-lib",
        validate: (value: unknown) => ({ value }),
      },
    };

    expect(() => catalogSchemaToJsonSchema(opaque)).toThrow(/mystery-lib/);
  });
});

const makeCatalog = (schema: unknown) =>
  ({
    id: "filing-tracker-catalog",
    components: new Map([["FilingCard", { schema, render: () => null }]]),
  }) as never;

describe("extractCatalogComponentSchemas", () => {
  it("keeps a Zod v4 component's props in the emitted catalog schema", () => {
    const { catalogId, components } = extractReactCatalogSchemas(
      makeCatalog(zodV4Like()),
    );

    expect(catalogId).toBe("filing-tracker-catalog");
    const entry = components.FilingCard as {
      allOf: Array<{
        properties?: Record<string, unknown>;
        required?: string[];
      }>;
    };
    const [, shapeEntry] = entry.allOf;

    // Without the conversion fix this is `["component"]` alone — the model is
    // told the component exists but takes no props at all.
    expect(Object.keys(shapeEntry.properties ?? {})).toEqual([
      "component",
      "filingId",
      "status",
      "risk",
    ]);
    expect(shapeEntry.required).toEqual([
      "component",
      "filingId",
      "status",
      "risk",
    ]);
  });
});
