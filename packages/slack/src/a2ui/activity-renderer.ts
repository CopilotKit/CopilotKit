import type { KnownBlock } from "@slack/types";
import { z } from "zod";
import {
  ComponentContext,
  MessageProcessor,
  type SurfaceModel,
} from "@a2ui/web_core/v0_9";
import type { ActivityMessageRenderer } from "../activity-message-renderer.js";
import type {
  ActionPayload,
  Catalog,
  EncodedAction,
  SlackComponentImplementation,
} from "./types.js";

/**
 * The canonical AG-UI activity type for A2UI surfaces (matches
 * `A2UIActivityType` in `@ag-ui/a2ui-middleware`).
 */
export const A2UI_ACTIVITY_TYPE = "a2ui-surface";

/**
 * Zod schema for the activity message content the A2UI middleware
 * emits:
 *
 *   content: { a2ui_operations: A2UIMessage[] }
 *
 * We accept any object shape inside `a2ui_operations` and hand it
 * straight to `@a2ui/web_core`'s `MessageProcessor`, which has its
 * own (more precise) validation.
 */
const a2uiOperationSchema = z.record(z.string(), z.unknown());
const a2uiActivityContentSchema = z.object({
  a2ui_operations: z.array(a2uiOperationSchema),
});

export type A2UIActivityContent = z.infer<typeof a2uiActivityContentSchema>;

/**
 * Full payload encoded into a `button.value` for click round-trip.
 * Matches `@ag-ui/a2ui-middleware`'s `A2UIUserAction` shape so the
 * bridge can forward the decoded value as
 * `forwardedProps.a2uiAction.userAction` without remap.
 */
export interface EncodedUserAction {
  name?: string;
  surfaceId: string;
  sourceComponentId: string;
  context?: Record<string, unknown>;
}

export function defaultEncodeUserAction(a: EncodedUserAction): EncodedAction {
  return JSON.stringify(a);
}

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
   * `JSON.stringify`, fine for typical small payloads. Renderers
   * producing large contexts should pass a shorter encoding.
   */
  encodeAction?: (a: EncodedUserAction) => EncodedAction;
  /**
   * If set, this renderer only fires for activity messages produced
   * by the named agent. Useful when the same bridge talks to multiple
   * agents with different catalogs.
   */
  agentId?: string;
}

/**
 * Build an `ActivityMessageRenderer` for `activityType: "a2ui-surface"`
 * driven by the given catalog(s).
 *
 * On each incoming activity message we spin up a fresh
 * `MessageProcessor` over the catalog(s), feed it
 * `content.a2ui_operations`, then walk every resulting surface and
 * recurse from `id: "root"`. Each component's resolved props come
 * from `@a2ui/web_core`'s `GenericBinder` (run inside the wrapped
 * `SlackComponentImplementation.render`); structural children, data
 * bindings, and action resolution are all handled by web_core.
 *
 * Click handling: when the rendered Block Kit button is clicked,
 * Slack delivers a `block_actions` event whose `value` carries the
 * encoded `EncodedUserAction`. The bridge decodes it (same machinery
 * as HITL pickers) and dispatches via
 * `forwardedProps.a2uiAction.userAction`.
 *
 * A fresh processor per render keeps the renderer stateless — agents
 * emit activity messages with the FULL op log for the surface(s)
 * they cover, so re-deriving from scratch yields the same surface
 * state as incremental application would.
 */
export function createA2UIActivityRenderer(
  opts: CreateA2UIActivityRendererOptions,
): ActivityMessageRenderer<A2UIActivityContent> {
  const encode = opts.encodeAction ?? defaultEncodeUserAction;
  const catalogs: ReadonlyArray<Catalog> = Array.isArray(opts.catalog)
    ? (opts.catalog as ReadonlyArray<Catalog>)
    : [opts.catalog as Catalog];
  const a2uiCatalogs = catalogs.map((c) => c._a2uiCatalog);

  return {
    activityType: A2UI_ACTIVITY_TYPE,
    agentId: opts.agentId,
    content: a2uiActivityContentSchema,
    render({ content }) {
      const processor = new MessageProcessor<SlackComponentImplementation>(
        a2uiCatalogs,
      );
      // `content.a2ui_operations` is the raw wire shape — web_core's
      // `A2uiMessage` is a discriminated union but `processMessages`
      // tolerates the raw object form and validates internally. Cast
      // through unknown to bypass TS's discriminated-union narrowing.
      processor.processMessages(content.a2ui_operations as never);

      const blocks: KnownBlock[] = [];
      for (const surface of processor.model.surfacesMap.values()) {
        blocks.push(...renderSurface(surface, encode));
      }
      return blocks;
    },
  };
}

/**
 * Walk a surface's component tree starting at `id: "root"`,
 * dispatching each node to its catalog's render function. Recursion
 * is via `buildChild` passed into the render — matches the React
 * adapter's `buildChild(id, basePath?)` signature so renderers
 * authored for the React path drop in with only the return type
 * differing.
 */
function renderSurface(
  surface: SurfaceModel<SlackComponentImplementation>,
  encode: (a: EncodedUserAction) => EncodedAction,
): KnownBlock[] {
  const warned = new Set<string>();

  const renderOne = (id: string, basePath?: string): KnownBlock[] => {
    const comp = surface.componentsModel.get(id);
    if (!comp) return [];
    const impl = surface.catalog.components.get(comp.type);
    if (!impl) {
      if (!warned.has(comp.type)) {
        warned.add(comp.type);
        console.warn(
          "[slack-bridge/a2ui] no renderer for component %s on catalog %s — skipping",
          comp.type,
          surface.catalog.id,
        );
      }
      return [];
    }

    const context = new ComponentContext(surface, id, basePath ?? "/");

    const dispatch = {
      encodeAction: (action: ActionPayload): EncodedAction =>
        encode({
          name: action.event.name,
          surfaceId: surface.id,
          sourceComponentId: id,
          context: action.event.context,
        }),
    };

    try {
      return impl.render({
        context,
        buildChild: (childId, childBasePath) =>
          renderOne(childId, childBasePath ?? basePath),
        dispatch,
      });
    } catch (err) {
      console.error(
        "[slack-bridge/a2ui] renderer threw for component %s on surface %s:",
        comp.type,
        surface.id,
        err,
      );
      return [];
    }
  };

  return renderOne("root");
}
