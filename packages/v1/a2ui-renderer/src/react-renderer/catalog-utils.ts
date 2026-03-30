import { basicCatalog } from "./a2ui-react";
import type { ComponentApi, Catalog } from "@a2ui/web_core/v0_9";
import { zodToJsonSchema } from "zod-to-json-schema";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

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
 * Build a context string describing available A2UI catalogs and custom components.
 * Custom components (those not in the basic catalog) are described using their
 * JSON Schema representation, matching the canonical A2UI catalog format.
 */
export function buildCatalogContextValue(
  catalogs: Catalog<ComponentApi>[],
): string {
  const resolved = catalogs.length > 0 ? catalogs : [basicCatalog];
  const lines: string[] = [];
  lines.push("Available A2UI catalogs:");

  for (const catalog of resolved) {
    if (catalog.id === BASIC_CATALOG_ID) {
      lines.push(`- ${catalog.id} (basic catalog)`);
      continue;
    }

    const isSuperset = extendsBasicCatalog(catalog);
    const customNames = getCustomComponentNames(catalog);

    lines.push(`- ${catalog.id}`);
    if (isSuperset) {
      lines.push(
        "  Extends the basic catalog with all standard components plus:",
      );
    } else {
      lines.push("  Custom catalog (does NOT include all basic components).");
      lines.push("  Custom components:");
    }

    for (const name of customNames) {
      const comp = catalog.components.get(name);
      if (!comp) continue;
      const jsonSchema = zodToJsonSchema(comp.schema);
      lines.push(`  - ${name}:`);
      lines.push(
        `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
      );
    }
  }

  return lines.join("\n");
}
