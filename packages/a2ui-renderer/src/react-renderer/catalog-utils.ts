import { basicCatalog } from "./a2ui-react";
import type { ComponentApi, Catalog } from "@a2ui/web_core/v0_9";
import {
  buildCatalogContextValue as buildContextValue,
  extractCatalogComponentSchemas as extractComponentSchemas,
} from "../catalog-schema";
import type { InlineCatalogSchema } from "../catalog-schema";

export { A2UI_SCHEMA_CONTEXT_DESCRIPTION } from "../catalog-schema";
export type { InlineCatalogSchema } from "../catalog-schema";

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
  return buildContextValue(catalog ?? basicCatalog, options);
}

/**
 * Extract component schemas from a catalog in the A2UI v0.9 inline catalog
 * format. Defaults to the basic catalog.
 */
export function extractCatalogComponentSchemas(
  catalog?: Catalog<ComponentApi>,
): InlineCatalogSchema {
  return extractComponentSchemas(catalog ?? basicCatalog);
}
