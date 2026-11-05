import { BASIC_COMPONENTS } from "@a2ui/web_core/v0_9/basic_catalog";
import {
  A2UI_BASIC_CATALOG_ID,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildA2UICatalogContextValue,
  extractA2UICatalogSchemas,
} from "@copilotkit/shared";
import type { A2UIInlineCatalogSchema } from "@copilotkit/shared";
import { A2UICatalog } from "./a2ui-types";

/**
 * `A2UI_SCHEMA_CONTEXT_DESCRIPTION` identifies the A2UI component schema in
 * RunAgentInput.context; `A2UI_BASIC_CATALOG_ID` is the id of the A2UI basic
 * catalog, which web_core does not export.
 */
export { A2UI_BASIC_CATALOG_ID, A2UI_SCHEMA_CONTEXT_DESCRIPTION };

type CatalogSchemas = Pick<A2UICatalog, "id" | "components"> &
  Partial<Pick<A2UICatalog, "functions" | "themeSchema">>;

const basicComponentNames: ReadonlySet<string> = new Set(
  BASIC_COMPONENTS.map((api) => api.name),
);

/**
 * Describes the catalog's id and its components beyond the basic catalog.
 *
 * When `options.includeSchema` is `false`, custom components are listed by name
 * only and their JSON schemas are omitted.
 */
export function buildCatalogContextValue(
  catalog: CatalogSchemas,
  options?: { includeSchema?: boolean },
): string {
  return buildA2UICatalogContextValue(catalog, basicComponentNames, options);
}

/** The catalog's component, function and theme schemas in the A2UI v0.9 inline catalog format. */
export function extractCatalogComponentSchemas(
  catalog: CatalogSchemas,
): A2UIInlineCatalogSchema {
  return extractA2UICatalogSchemas(catalog);
}
