import { basicCatalog } from "./a2ui-react";
import type { ComponentApi, Catalog, InlineCatalog } from "@a2ui/web_core/v0_9";
import {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildA2UICatalogContextValue,
  extractA2UICatalogSchemas,
} from "@copilotkit/shared";

/**
 * Context description used to identify the A2UI component schema in RunAgentInput.context.
 * Must match the constant in @ag-ui/a2ui-middleware so the middleware can overwrite
 * a frontend-provided schema with a server-side one.
 */
export { A2UI_SCHEMA_CONTEXT_DESCRIPTION };

const basicComponentNames: ReadonlySet<string> = new Set(
  basicCatalog.components.keys(),
);

/**
 * Check whether a catalog is a superset of the basic catalog
 * (i.e., it contains all basic components by name).
 */
export function extendsBasicCatalog(catalog: Catalog<ComponentApi>): boolean {
  for (const name of basicComponentNames) {
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
  return [...catalog.components.keys()].filter(
    (name) => !basicComponentNames.has(name),
  );
}

/**
 * Build a context string describing the available A2UI catalog and custom components.
 * Custom components (those not in the basic catalog) are described using their
 * JSON Schema representation, serialized the same way as
 * {@link extractCatalogComponentSchemas}.
 *
 * When `options.includeSchema` is `false`, custom components are listed by name
 * only and their JSON schemas are omitted.
 */
export function buildCatalogContextValue(
  catalog?: Catalog<ComponentApi>,
  options?: { includeSchema?: boolean },
): string {
  return buildA2UICatalogContextValue(
    catalog ?? basicCatalog,
    basicComponentNames,
    options,
  );
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
 * Extract component, function and theme schemas from a catalog in the A2UI
 * v0.9 inline catalog format. See `extractA2UICatalogSchemas` in
 * `@copilotkit/shared` for how this differs from `getClientCapabilities` in
 * `@a2ui/web_core`.
 *
 * When sent via `useAgentContext` with `A2UI_SCHEMA_CONTEXT_DESCRIPTION`,
 * the middleware can optionally overwrite it with a server-side schema.
 */
export function extractCatalogComponentSchemas(
  catalog?: Catalog<ComponentApi>,
): InlineCatalogSchema {
  return extractA2UICatalogSchemas(
    catalog ?? basicCatalog,
  ) as InlineCatalogSchema;
}
