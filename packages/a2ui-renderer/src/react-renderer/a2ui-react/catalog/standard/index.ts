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
import { dataDefinitions } from "./definitions/data";
import { dataRenderers } from "./renderers/data";
import { mediaDefinitions } from "./definitions/media";
import { mediaRenderers } from "./renderers/media";
import { compositeDefinitions } from "./definitions/composites";
import { compositeRenderers } from "./renderers/composites";
import { STANDARD_CATALOG_ID } from "./tokens";

/** All standard-catalog component definitions (zod props + descriptions). */
export const standardDefinitions = {
  ...layoutDefinitions,
  ...textDefinitions,
  ...inputDefinitions,
  ...feedbackDefinitions,
  ...dataDefinitions,
  ...mediaDefinitions,
  ...compositeDefinitions,
};

/** React renderers for every entry in `standardDefinitions`. */
export const standardRenderers: CatalogRenderers<typeof standardDefinitions> = {
  ...layoutRenderers,
  ...textRenderers,
  ...inputRenderers,
  ...feedbackRenderers,
  ...dataRenderers,
  ...mediaRenderers,
  ...compositeRenderers,
};

/** The standard catalog, modelled on ChatGPT Intelligent UI. */
export const standardCatalog = createCatalog(
  standardDefinitions,
  standardRenderers,
  { catalogId: STANDARD_CATALOG_ID, includeBasicCatalog: false },
);

export * from "./tokens";
