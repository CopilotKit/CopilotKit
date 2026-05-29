import { Catalog as A2UICatalog, GenericBinder } from "@a2ui/web_core/v0_9";
import type {
  Catalog,
  CatalogDefinitions,
  CatalogRenderers,
  SlackComponentImplementation,
} from "./types.js";

const DEFAULT_CATALOG_ID = "copilotkit://slack-catalog";

export interface CreateCatalogOptions {
  /**
   * Stable identifier for this catalog. Must match the `catalogId` the
   * agent uses in `a2ui.create_surface(..., catalog_id=...)`. Defaults
   * to `"copilotkit://slack-catalog"`, fine for single-catalog apps;
   * set explicitly when the agent might be talking to multiple A2UI
   * hosts.
   */
  catalogId?: string;
}

/**
 * Build a Slack A2UI catalog from platform-agnostic component
 * definitions (Zod schemas + descriptions) and Slack-specific
 * renderers (KnownBlock[]).
 *
 * Internally this wraps each renderer into a
 * `SlackComponentImplementation` (extending `@a2ui/web_core`'s
 * `ComponentApi`) and bundles them into a web_core `Catalog`. The
 * bridge's render pipeline drives `MessageProcessor` over the
 * web_core catalog — that machinery handles surface-state, data
 * bindings, child-list iteration, action resolution. The user
 * never sees web_core; they just see `Catalog` / `CatalogRenderers`.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createCatalog } from "@copilotkit/slack";
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
  const catalogId = options.catalogId ?? DEFAULT_CATALOG_ID;
  const components: SlackComponentImplementation[] = Object.entries(
    definitions,
  ).map(([name, def]) => {
    // The user's render function takes RESOLVED props (what GenericBinder
    // hands out); we adapt it to web_core's render signature by running
    // the binder for each render call. Slack only needs a one-shot
    // snapshot per render — no useSyncExternalStore equivalent — so we
    // dispose the binder immediately after.
    const userRender = (renderers as Record<string, any>)[name];
    return {
      name,
      schema: def.props,
      render({ context, buildChild, dispatch }) {
        const binder = new GenericBinder<Record<string, any>>(
          context,
          def.props,
        );
        try {
          return userRender({
            props: binder.snapshot,
            context,
            children: buildChild,
            dispatch,
          });
        } finally {
          binder.dispose();
        }
      },
    };
  });

  const a2uiCatalog = new A2UICatalog<SlackComponentImplementation>(
    catalogId,
    components,
  );

  return {
    catalogId,
    definitions,
    // Erase the specific D from the public return type — same trick
    // the React-side createCatalog uses. Construction-time type-checks
    // already validated renderers against definitions; the bridge
    // (consumer) only needs the runtime-typed Catalog shape.
    renderers: renderers as unknown as Catalog["renderers"],
    _a2uiCatalog: a2uiCatalog,
  };
}
