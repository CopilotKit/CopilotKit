import type { Catalog, CatalogDefinitions, CatalogRenderers } from "./types.js";

const DEFAULT_CATALOG_ID = "copilotkit://slack-catalog";

export interface CreateCatalogOptions {
  /**
   * Stable identifier for this catalog. Must match the `catalogId` the
   * agent uses in its `a2ui.create_surface(..., catalog_id=...)` ops,
   * so the bridge knows which catalog to dispatch incoming a2ui
   * operations to. Defaults to `"copilotkit://slack-catalog"`, which
   * is fine for single-catalog apps but should be set explicitly if
   * the same agent might be talking to multiple A2UI hosts.
   */
  catalogId?: string;
}

/**
 * Build a Slack A2UI catalog from platform-agnostic component
 * definitions (Zod schemas + descriptions) and Slack-specific
 * renderers (Block Kit). TypeScript enforces that every component
 * named in `definitions` has a matching renderer with the right
 * prop types.
 *
 * Definitions are intentionally platform-agnostic so the same module
 * can be reused with the React A2UI renderer on the web side; only
 * the renderers differ per platform.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createCatalog } from "@copilotkitnext/slack";
 *
 * const definitions = {
 *   Greeting: {
 *     description: "A friendly greeting.",
 *     props: z.object({ name: z.string() }),
 *   },
 * };
 *
 * export const myCatalog = createCatalog(
 *   definitions,
 *   {
 *     Greeting: ({ props }) => [
 *       { type: "section",
 *         text: { type: "mrkdwn", text: `Hello, *${props.name}*!` } },
 *     ],
 *   },
 *   { catalogId: "copilotkit://my-app" },
 * );
 * ```
 */
export function createCatalog<D extends CatalogDefinitions>(
  definitions: D,
  renderers: CatalogRenderers<D>,
  options: CreateCatalogOptions = {},
): Catalog {
  // The return type erases the specific `D` (parallel to the React
  // a2ui-renderer, which returns `Catalog<ReactComponentImplementation>`).
  // At construction time TypeScript still validates that `renderers`
  // matches `definitions`; at consumption time (the bridge) we only
  // care about the runtime-typed shape, so widening here avoids
  // assignment-variance pain when threading the catalog through
  // `SlackBridgeConfig.a2ui.catalog`.
  return {
    catalogId: options.catalogId ?? DEFAULT_CATALOG_ID,
    definitions,
    renderers: renderers as unknown as Catalog["renderers"],
  };
}
