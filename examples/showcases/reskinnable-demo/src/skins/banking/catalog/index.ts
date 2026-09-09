import { createCatalog, extractSchema } from "@copilotkit/a2ui-renderer";
import { CATALOG_ID, definitions } from "./definitions";
import { renderers } from "./renderers";

export const catalog = createCatalog(definitions, renderers, {
  catalogId: CATALOG_ID,
  includeBasicCatalog: false,
});

export const catalogSchema = extractSchema(definitions);

export { CATALOG_ID, definitions };
