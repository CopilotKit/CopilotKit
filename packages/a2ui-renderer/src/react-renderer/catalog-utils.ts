import { basicCatalog } from "./a2ui-react";
import type { ComponentApi, Catalog, InlineCatalog } from "@a2ui/web_core/v0_9";
import { zodToJsonSchema } from "zod-to-json-schema";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

/**
 * Context description used to identify the A2UI component schema in RunAgentInput.context.
 * Must match the constant in @ag-ui/a2ui-middleware so the middleware can overwrite
 * a frontend-provided schema with a server-side one.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

/**
 * Check whether a catalog is a superset of the basic catalog
 * (i.e., it contains all basic components by name).
 */
export function extendsBasicCatalog(catalog: Catalog<ComponentApi>): boolean {
  for (const name of basicCatalog.components.keys()) {
    if (!catalog.components.has(name)) {
      return false;
    }
  }
  return true;
}

/**
 * Return the names of components in a catalog that are not in the basic catalog.
 */
export function getCustomComponentNames(
  catalog: Catalog<ComponentApi>,
): string[] {
  const custom: string[] = [];
  for (const name of catalog.components.keys()) {
    if (!basicCatalog.components.has(name)) {
      custom.push(name);
    }
  }
  return custom;
}

/**
 * Build a context string describing the available A2UI catalog and custom components.
 * Custom components (those not in the basic catalog) are described using their
 * JSON Schema representation, matching the canonical A2UI catalog format.
 *
 * When `options.includeSchema` is `false`, custom components are listed by name
 * only and their JSON schemas are omitted.
 */
export function buildCatalogContextValue(
  catalog?: Catalog<ComponentApi>,
  options?: { includeSchema?: boolean },
): string {
  const resolved = catalog ?? basicCatalog;
  const lines: string[] = [];
  lines.push("Available A2UI catalog:");

  if (resolved.id === BASIC_CATALOG_ID) {
    lines.push(`- ${resolved.id} (basic catalog)`);
    return lines.join("\n");
  }

  const isSuperset = extendsBasicCatalog(resolved);
  const customNames = getCustomComponentNames(resolved);

  lines.push(`- ${resolved.id}`);
  if (isSuperset) {
    lines.push(
      "  Extends the basic catalog with all standard components plus:",
    );
  } else {
    lines.push("  Custom catalog (does NOT include all basic components).");
    lines.push("  Custom components:");
  }

  for (const name of customNames) {
    const comp = resolved.components.get(name);
    if (!comp) continue;
    if (options?.includeSchema === false) {
      lines.push(`  - ${name}`);
      continue;
    }
    const jsonSchema = zodToJsonSchema(comp.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * A2UI v0.9 inline catalog format — matches the structure defined by the
 * A2UI specification (basic_catalog.json).  Each component is keyed by
 * name and uses `allOf` to compose ComponentCommon with component-specific
 * properties so the schema mirrors the flat wire format the LLM must produce.
 */
export interface InlineCatalogSchema extends Omit<InlineCatalog, "components"> {
  components: Record<string, Record<string, unknown>>;
}

/**
 * Extract component schemas from a catalog in the A2UI v0.9 inline catalog
 * format.  This mirrors `generateInlineCatalog` from `@a2ui/web_core` so
 * the schema the LLM sees matches the spec and the flat wire format:
 *
 *   { "Column": { "allOf": [
 *       { "$ref": "common_types.json#/$defs/ComponentCommon" },
 *       { "properties": { "component": {"const":"Column"}, "gap": ..., "children": ... },
 *         "required": ["component"] }
 *   ]}}
 *
 * When sent via `useAgentContext` with `A2UI_SCHEMA_CONTEXT_DESCRIPTION`,
 * the middleware can optionally overwrite it with a server-side schema.
 */
export function extractCatalogComponentSchemas(
  catalog?: Catalog<ComponentApi>,
): InlineCatalogSchema {
  const resolved = catalog ?? basicCatalog;
  const components: Record<string, Record<string, unknown>> = {};

  for (const [name, comp] of resolved.components) {
    const zodSchema = serializeCatalogSchema(comp.schema);

    components[name] = {
      allOf: [
        { $ref: "common_types.json#/$defs/ComponentCommon" },
        {
          properties: {
            component: { const: name },
            ...zodSchema.properties,
          },
          required: ["component", ...(zodSchema.required ?? [])],
        },
      ],
    };
  }

  const functions = Array.from(resolved.functions?.values() ?? [], (api) => ({
    name: api.name,
    description: api.schema.description,
    returnType: api.returnType,
    parameters: serializeCatalogSchema(api.schema),
  }));
  const theme = resolved.themeSchema
    ? serializeCatalogSchema(resolved.themeSchema).properties
    : undefined;

  return {
    catalogId: resolved.id,
    components,
    functions: functions.length > 0 ? functions : undefined,
    theme,
  };
}

function serializeCatalogSchema(schema: ComponentApi["schema"]) {
  const jsonSchema = zodToJsonSchema(schema, {
    target: "jsonSchema2019-09",
    // The component envelope moves properties under allOf[1], and REF markers
    // can replace an entire subtree (e.g. accessibility). Inline reused schemas
    // first so neither operation leaves references to their former locations.
    $refStrategy: "none",
  }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  processCatalogRefs(jsonSchema);
  return jsonSchema;
}

/**
 * Adapted from MessageProcessor.processRefs in @a2ui/web_core 0.10.4,
 * src/v0_9/processing/message-processor.js (Copyright 2025 Google LLC,
 * Apache-2.0). Keep its REF: conversion semantics aligned with upstream.
 *
 * getClientCapabilities has no public schema-conversion hook or $refStrategy
 * option, so it can leave aliases pointing into subtrees removed by REF tags.
 * Replace this adapter with the public serializer when it supports inlining
 * reused schemas before processing REF tags.
 */
function processCatalogRefs(node: unknown): void {
  if (typeof node !== "object" || node === null) return;

  const schema = node as Record<string, unknown>;
  if (
    typeof schema.description === "string" &&
    schema.description.startsWith("REF:")
  ) {
    const [ref, description] = schema.description.slice(4).split("|");
    for (const key of Object.keys(schema)) delete schema[key];
    schema.$ref = ref;
    if (description) schema.description = description;
    return;
  }

  for (const child of Object.values(schema)) processCatalogRefs(child);
}
