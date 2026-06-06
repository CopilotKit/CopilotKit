/**
 * The A2UI catalog. Pairs definitions (Zod schemas) with React renderers
 * and exposes it under a stable catalogId the server-side tool references.
 */
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import { CATALOG_ID, definitions } from "./definitions";
import { renderers } from "./renderers";

/* The a2ui-renderer's CatalogDefinitions type pins to an internal v3
   ZodObject. Our definitions use zod/v3 from a different bundle, so
   the structural types don't line up. Runtime data is identical. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const catalog = createCatalog(
  definitions as any,
  renderers as unknown as CatalogRenderers<any>,
  { catalogId: CATALOG_ID, includeBasicCatalog: false },
);


export { CATALOG_ID, definitions };
