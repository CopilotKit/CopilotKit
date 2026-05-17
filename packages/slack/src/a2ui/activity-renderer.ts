import type { KnownBlock } from "@slack/types";
import { z } from "zod";
import type { ActivityMessageRenderer } from "../activity-message-renderer.js";
import type { Catalog, EncodedAction } from "./types.js";
import { applyA2UIOperations, type A2UIOperation } from "./surface-state.js";
import {
  defaultEncodeUserAction,
  renderA2UISurface,
  type EncodedUserAction,
} from "./render.js";

/**
 * The canonical AG-UI activity type for A2UI surfaces (matches
 * `A2UIActivityType` in `@ag-ui/a2ui-middleware`).
 */
export const A2UI_ACTIVITY_TYPE = "a2ui-surface";

/**
 * Zod schema for the activity message content the A2UI middleware
 * emits. Mirrors the wire format:
 *
 *   content: { a2ui_operations: A2UIOperation[] }
 */
const a2uiOperationSchema = z
  .object({
    version: z.string().optional(),
    createSurface: z
      .object({
        surfaceId: z.string(),
        catalogId: z.string(),
        theme: z.record(z.unknown()).optional(),
        attachDataModel: z.boolean().optional(),
      })
      .optional(),
    updateComponents: z
      .object({
        surfaceId: z.string(),
        components: z.array(z.record(z.unknown())),
      })
      .optional(),
    updateDataModel: z
      .object({
        surfaceId: z.string(),
        path: z.string().optional(),
        value: z.unknown().optional(),
        data: z.unknown().optional(),
      })
      .optional(),
    deleteSurface: z
      .object({
        surfaceId: z.string(),
      })
      .optional(),
  })
  .passthrough();

const a2uiActivityContentSchema = z.object({
  a2ui_operations: z.array(a2uiOperationSchema),
});

export type A2UIActivityContent = z.infer<typeof a2uiActivityContentSchema>;

export interface CreateA2UIActivityRendererOptions {
  /**
   * Catalog(s) used to render incoming surfaces. The renderer routes
   * each surface to the catalog whose `catalogId` matches the
   * surface's `catalogId` op. Surfaces with no matching catalog are
   * silently skipped.
   *
   * Pass a single catalog for the common case; pass an array to drive
   * BOTH a fixed-schema flight surface and a dynamic-schema dashboard
   * surface (or any other combination) from one bridge.
   */
  catalog: Catalog | ReadonlyArray<Catalog>;
  /**
   * Optional encoder for click payloads — packs an `EncodedUserAction`
   * (matches `@ag-ui/a2ui-middleware`'s `A2UIUserAction` shape) into a
   * Slack `button.value` (Slack caps it at 2000 chars). Default:
   * `JSON.stringify`, which is fine for typical small payloads.
   *
   * Renderers that produce very large action contexts should pass a
   * shorter encoding (e.g. drop the entire `context` and rebuild it
   * agent-side from `name` + `surfaceId`, or store the heavy context
   * in a per-surface registry and encode just a short id).
   */
  encodeAction?: (a: EncodedUserAction) => EncodedAction;
  /**
   * If set, this renderer only fires for activity messages produced
   * by the named agent. Useful when the same bridge talks to multiple
   * agents and you want different catalogs per agent.
   */
  agentId?: string;
}

/**
 * Build an `ActivityMessageRenderer` for `activityType: "a2ui-surface"`
 * that drives the given `catalog`.
 *
 * Each incoming activity message contains the FULL operation log for
 * the surfaces it covers (snapshot semantics). We replay the
 * operations to derive surface state, then walk each surface's
 * component tree via the catalog renderers, and concatenate the
 * resulting blocks. Multiple surfaces in one activity message
 * render as adjacent block groups.
 *
 * Click handling: when a button is clicked in Slack, its
 * `block_actions` event carries the encoded payload. The bridge
 * decodes it (same machinery as HITL pickers) and dispatches it
 * back to the agent via `forwardedProps.a2uiAction` — closing the
 * loop without any special A2UI plumbing on the bridge call path.
 */
export function createA2UIActivityRenderer(
  opts: CreateA2UIActivityRendererOptions,
): ActivityMessageRenderer<A2UIActivityContent> {
  const encode = opts.encodeAction ?? defaultEncodeUserAction;
  // Normalize to an array up front so the render path doesn't branch.
  const catalogs: ReadonlyArray<Catalog> = Array.isArray(opts.catalog)
    ? (opts.catalog as ReadonlyArray<Catalog>)
    : [opts.catalog as Catalog];
  const byId = new Map<string, Catalog>(catalogs.map((c) => [c.catalogId, c]));

  return {
    activityType: A2UI_ACTIVITY_TYPE,
    agentId: opts.agentId,
    content: a2uiActivityContentSchema,
    render({ content }) {
      const operations = content.a2ui_operations as A2UIOperation[];
      const surfaces = applyA2UIOperations(operations);

      const blocks: KnownBlock[] = [];
      for (const surface of surfaces.values()) {
        const catalog = byId.get(surface.catalogId);
        // Surfaces whose catalogId we don't know are someone else's
        // problem — silently skip rather than crash.
        if (!catalog) continue;
        blocks.push(...renderA2UISurface(surface, catalog, encode));
      }
      return blocks;
    },
  };
}
