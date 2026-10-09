import { BASIC_COMPONENTS } from "@a2ui/web_core/v0_9/basic_catalog";
import { zodToJsonSchema } from "zod-to-json-schema";
import { A2UICatalog } from "./a2ui-types";

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

type CatalogSchemas = Pick<A2UICatalog, "id" | "components">;

const basicComponentNames = new Set(BASIC_COMPONENTS.map((api) => api.name));

/** Describes the catalog's id and its components beyond the basic catalog. */
export function buildCatalogContextValue(catalog: CatalogSchemas): string {
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
    const jsonSchema = zodToJsonSchema(component.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

/** The catalog's component schemas in the A2UI v0.9 inline catalog format. */
export function extractCatalogComponentSchemas(catalog: CatalogSchemas): {
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
} {
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
