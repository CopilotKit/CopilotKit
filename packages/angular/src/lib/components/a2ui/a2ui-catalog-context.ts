/**
 * Describes an A2UI catalog to the agent. React and Vue share the same
 * framework-neutral implementation from `@copilotkit/a2ui-renderer`, which
 * does not import React.
 */
export {
  A2UI_BASIC_CATALOG_ID,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "@copilotkit/a2ui-renderer/catalog-schema";
