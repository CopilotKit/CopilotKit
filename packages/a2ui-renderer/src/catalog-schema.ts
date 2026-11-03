/**
 * Framework-neutral A2UI catalog support, loaded through the
 * `@copilotkit/a2ui-renderer/catalog-schema` subpath without React: the
 * catalog description and schemas for the agent context, the context
 * entries built from them, catalog filtering, and the controller that keeps
 * a catalog in sync with core. React, Vue and Angular all use it.
 */
export {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  A2UI_BASIC_CATALOG_ID,
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "./catalog-description";
export type {
  CatalogSchemaSource,
  InlineCatalogSchema,
} from "./catalog-description";
export {
  A2UI_CAPABILITIES_CONTEXT_DESCRIPTION,
  A2UI_GENERATION_GUIDELINES_CONTEXT_DESCRIPTION,
  A2UI_DESIGN_GUIDELINES_CONTEXT_DESCRIPTION,
  buildA2UIContextEntries,
} from "./catalog-context";
export type { A2UIContextEntry } from "./catalog-context";
export { filterCatalog } from "./filter-catalog";
export { A2UICatalogController } from "./catalog-controller";
export type { A2UICatalogCore, A2UICatalogState } from "./catalog-controller";
