import { createCatalog } from "../../../create-catalog";
import type { CatalogRenderers } from "../../../create-catalog";
import { layoutDefinitions } from "./definitions/layout";
import { layoutRenderers } from "./renderers/layout";
import { textDefinitions } from "./definitions/text";
import { textRenderers } from "./renderers/text";
import { inputDefinitions } from "./definitions/inputs";
import { inputRenderers } from "./renderers/inputs";
import { feedbackDefinitions } from "./definitions/feedback";
import { feedbackRenderers } from "./renderers/feedback";
import { STANDARD_CATALOG_ID } from "./tokens";

/** All standard-catalog component definitions (zod props + descriptions). */
export const standardDefinitions = {
  ...layoutDefinitions,
  ...textDefinitions,
  ...inputDefinitions,
  ...feedbackDefinitions,
};

/** React renderers for every entry in `standardDefinitions`. */
export const standardRenderers: CatalogRenderers<typeof standardDefinitions> = {
  ...layoutRenderers,
  ...textRenderers,
  ...inputRenderers,
  ...feedbackRenderers,
};

/** The standard catalog, modelled on ChatGPT Intelligent UI. */
export const standardCatalog = createCatalog(
  standardDefinitions,
  standardRenderers,
  { catalogId: STANDARD_CATALOG_ID, includeBasicCatalog: false },
);

export * from "./tokens";
