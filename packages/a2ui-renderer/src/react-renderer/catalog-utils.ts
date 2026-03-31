import { basicCatalog } from "./a2ui-react";
import type { ComponentApi, Catalog } from "@a2ui/web_core/v0_9";
import { zodToJsonSchema } from "zod-to-json-schema";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

/**
 * Context description used to identify the A2UI component schema in RunAgentInput.context.
 * Must match the constant in @ag-ui/a2ui-middleware so the middleware can overwrite
 * a frontend-provided schema with a server-side one.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and props when creating A2UI operations.";

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
 */
export function buildCatalogContextValue(
  catalog?: Catalog<ComponentApi>,
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
    const jsonSchema = zodToJsonSchema(comp.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * Extract component schemas from a catalog in the same format used by
 * the A2UI middleware (`A2UIComponentSchema[]`). Each component's Zod
 * schema is converted to JSON Schema via zod-to-json-schema.
 *
 * When sent via `useAgentContext` with `A2UI_SCHEMA_CONTEXT_DESCRIPTION`,
 * the middleware can optionally overwrite it with a server-side schema.
 */
export function extractCatalogComponentSchemas(
  catalog?: Catalog<ComponentApi>,
): Array<{ name: string; props: Record<string, unknown> }> {
  const resolved = catalog ?? basicCatalog;
  const schemas: Array<{ name: string; props: Record<string, unknown> }> = [];

  for (const [name, comp] of resolved.components) {
    schemas.push({
      name,
      props: zodToJsonSchema(comp.schema, { target: "openApi3" }) as Record<
        string,
        unknown
      >,
    });
  }

  return schemas;
}
