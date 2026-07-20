import type { Context } from "@ag-ui/core";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { A2UIAngularCatalog } from "./a2ui-angular-catalog";

/**
 * Description of the AG-UI context entry that carries the custom catalog
 * metadata. Servers match on this exact string to extract the entry, so it
 * must stay stable.
 */
export const A2UI_CATALOG_CONTEXT_DESCRIPTION = "A2UI Custom Catalog";

/**
 * Serializes only the catalog id into an AG-UI context entry. Use this when
 * the server resolves the trusted catalog descriptor from its own registry
 * and must not rely on client-supplied metadata.
 */
export function catalogIdToContextEntry(catalogId: string): Context {
  return {
    description: A2UI_CATALOG_CONTEXT_DESCRIPTION,
    value: JSON.stringify({ catalogId, components: {} }),
  };
}

/**
 * Serializes a custom catalog into an AG-UI context entry so the agent can
 * adopt the catalog id and learn the custom component names, descriptions,
 * and prop schemas. The prop schemas are emitted as JSON Schema with
 * `$refStrategy: "none"`, keeping them inline so consumers do not have to
 * resolve `$ref` pointers. A catalog without components still yields an
 * entry, so the agent always receives the id.
 */
export function catalogToContextEntry(catalog: A2UIAngularCatalog): Context {
  const components = Object.fromEntries(
    catalog.components.map((component) => [
      component.name,
      {
        description: component.description,
        schema: zodToJsonSchema(component.schema, { $refStrategy: "none" }),
      },
    ]),
  );

  return {
    description: A2UI_CATALOG_CONTEXT_DESCRIPTION,
    value: JSON.stringify({ catalogId: catalog.id, components }),
  };
}
