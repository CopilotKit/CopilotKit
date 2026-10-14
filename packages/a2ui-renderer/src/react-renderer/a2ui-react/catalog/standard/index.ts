import { createCatalog } from "../../../create-catalog";
import type { CatalogRenderers } from "../../../create-catalog";
import { layoutDefinitions } from "./definitions/layout";
import { layoutRenderers } from "./renderers/layout";
import { textDefinitions } from "./definitions/text";
import { textRenderers } from "./renderers/text";
import { STANDARD_CATALOG_ID } from "./tokens";

/** All standard-catalog component definitions (zod props + descriptions). */
export const standardDefinitions = {
  ...layoutDefinitions,
  ...textDefinitions,
};

/** React renderers for every entry in `standardDefinitions`. */
export const standardRenderers: CatalogRenderers<typeof standardDefinitions> = {
  ...layoutRenderers,
  ...textRenderers,
};

/** The standard catalog. */
export const standardCatalog = createCatalog(
  standardDefinitions,
  standardRenderers,
  { catalogId: STANDARD_CATALOG_ID, includeBasicCatalog: false },
);

export * from "./tokens";
