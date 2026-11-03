/**
 * Framework-neutral A2UI catalog descriptions for the agent context.
 *
 * React (through this package's main entry), Vue and Angular all describe
 * their A2UI catalog to the agent with these two functions. This module
 * imports nothing from React, so Vue and Angular load it through the
 * `@copilotkit/a2ui-renderer/catalog-schema` subpath without React.
 *
 * Component schemas in an A2UI catalog are Zod 3 schemas: `@a2ui/web_core`
 * builds its basic catalog with Zod 3 and its binder reads Zod 3 internals.
 * Zod 3 schemas cannot describe themselves as JSON Schema, so this is the one
 * place in CopilotKit that still converts with `zod-to-json-schema`.
 */
import type { CatalogInterface, ComponentApi } from "@a2ui/web_core/v0_9";
import { BASIC_COMPONENTS } from "@a2ui/web_core/v0_9/basic_catalog";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Context description used to identify the A2UI component schema in
 * RunAgentInput.context. Must match the constant in @ag-ui/a2ui-middleware so
 * the middleware can overwrite a frontend-provided schema with a server-side one.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

/** Id of the A2UI basic catalog, which web_core does not export. */
export const A2UI_BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

/** The parts of a catalog that describe it to the agent. */
export type CatalogSchemaSource = Pick<
  CatalogInterface<ComponentApi>,
  "id" | "components"
>;

/**
 * A2UI v0.9 inline catalog format — matches the structure defined by the
 * A2UI specification (basic_catalog.json).  Each component is keyed by
 * name and uses `allOf` to compose ComponentCommon with component-specific
 * properties so the schema mirrors the flat wire format the LLM must produce.
 */
export interface InlineCatalogSchema {
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
}

const basicComponentNames: ReadonlySet<string> = new Set(
  BASIC_COMPONENTS.map((api) => api.name),
);

/**
 * Build a context string describing the available A2UI catalog and custom components.
 * Custom components (those not in the basic catalog) are described using their
 * JSON Schema representation, matching the canonical A2UI catalog format.
 *
 * When `options.includeSchema` is `false`, custom components are listed by name
 * only and their JSON schemas are omitted.
 */
export function buildCatalogContextValue(
  catalog: CatalogSchemaSource,
  options?: { includeSchema?: boolean },
): string {
  const lines: string[] = ["Available A2UI catalog:"];

  if (catalog.id === A2UI_BASIC_CATALOG_ID) {
    lines.push(`- ${catalog.id} (basic catalog)`);
    return lines.join("\n");
  }

  const isSuperset = [...basicComponentNames].every((name) =>
    catalog.components.has(name),
  );

  lines.push(`- ${catalog.id}`);
  if (isSuperset) {
    lines.push(
      "  Extends the basic catalog with all standard components plus:",
    );
  } else {
    lines.push("  Custom catalog (does NOT include all basic components).");
    lines.push("  Custom components:");
  }

  for (const [name, component] of catalog.components) {
    if (basicComponentNames.has(name)) continue;
    if (options?.includeSchema === false) {
      lines.push(`  - ${name}`);
      continue;
    }
    const jsonSchema = zodToJsonSchema(component.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
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
 * When sent via agent context with `A2UI_SCHEMA_CONTEXT_DESCRIPTION`,
 * the middleware can optionally overwrite it with a server-side schema.
 */
export function extractCatalogComponentSchemas(
  catalog: CatalogSchemaSource,
): InlineCatalogSchema {
  const components: Record<string, Record<string, unknown>> = {};

  for (const [name, component] of catalog.components) {
    const zodSchema = zodToJsonSchema(component.schema, {
      target: "jsonSchema2019-09",
    }) as { properties?: Record<string, unknown>; required?: string[] };

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

  return { catalogId: catalog.id, components };
}
