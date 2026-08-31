/**
 * The CopilotKit A2UI custom catalog.
 *
 * `catalog` is what we hand to the A2UI renderer on the frontend.
 * `schema` is what the agent's prompt cites so the LLM knows the
 * components + their props.
 *
 * Note: includeBasicCatalog is intentionally off. our catalog is the
 * complete design system. If you want Text/Button/Row from the basic
 * catalog for free, flip the flag.
 */
import { createCatalog, extractSchema } from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import { CATALOG_ID, definitions } from "./definitions";
import { renderers } from "./renderers";

/* The runtime's GenericBinder inspects these Zod schemas to decide which
 * props are DYNAMIC (auto-resolved against the data model). Use the same
 * Zod major version as @copilotkit/a2ui-renderer (zod@^3.25) or it
 * silently classifies everything as STATIC and `{path}` objects leak
 * through to the renderers.
 *
 * The renderers cast: definitions express props as `string | { path }`
 * (the wide pre-binding shape) but the binder hands the renderer the
 * resolved shape (`string`). Narrow at the boundary. */
export const catalog = createCatalog(
  definitions,
  renderers as unknown as CatalogRenderers<typeof definitions>,
  { catalogId: CATALOG_ID, includeBasicCatalog: false },
);

export const catalogSchema = extractSchema(definitions);

export { CATALOG_ID, definitions };
