import type { KnownBlock } from "@slack/types";
import type { z, ZodObject, ZodRawShape } from "zod";
import type {
  Catalog as A2UICatalog,
  ComponentApi,
  ComponentContext,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";

/**
 * A2UI catalog primitives for `@copilotkit/slack`.
 *
 * The Slack package consumes `@a2ui/web_core` for the heavy lifting
 * (operation processing, surface state, data-model bindings, child
 * resolution). What this package adds is the *Slack-host shape*:
 * renderers that return `KnownBlock[]` instead of ReactNode, plus
 * a click round-trip that encodes actions into `button.value`.
 *
 * `CatalogDefinitions` is intentionally platform-agnostic — apps can
 * (and should) share the same definitions module between a web
 * frontend and the Slack bot.
 *
 * NOTE: Unlike the rest of this SDK (tools, components, HITL,
 * interrupts — all schema-library-agnostic via Standard Schema), A2UI
 * catalog props are typed as **Zod** objects. This is an upstream
 * constraint: `@a2ui/web_core`'s `GenericBinder` introspects the schema
 * at render time to resolve `{ path }` data bindings and child lists,
 * and its `InferredComponentApiSchemaType` is Zod-shaped. Loosening this
 * to `StandardSchemaV1` would type-check but break binding resolution at
 * runtime for non-Zod libraries — so we keep the type honest until
 * web_core accepts Standard Schema directly.
 */

/**
 * A single component definition — Zod props schema + optional
 * description. Platform-agnostic: no rendering details.
 */
export interface CatalogComponentDefinition<
  T extends ZodRawShape = ZodRawShape,
> {
  /**
   * Zod object schema for the component's props. Zod specifically (not
   * any Standard Schema) — see the file-level note: `@a2ui/web_core`'s
   * binder requires it.
   */
  props: ZodObject<T>;
  /** Human-readable description shown to the agent so it picks well. */
  description?: string;
}

/**
 * A record mapping component names to their definitions.
 */
export type CatalogDefinitions = Record<
  string,
  CatalogComponentDefinition<any>
>;

/** Infer the props type for a specific component in a definitions record. */
export type PropsOf<D extends CatalogDefinitions, K extends keyof D> = z.infer<
  D[K]["props"]
>;

/**
 * Encoded action — a string ≤ 2000 chars suitable for Slack
 * `button.value`. Produced by `RendererProps.dispatch.encodeAction`.
 */
export type EncodedAction = string;

/**
 * The structured A2UI action shape — what catalog renderers describe
 * when a user interacts with an actionable component. The bridge
 * decodes this into a `forwardedProps.a2uiAction.userAction` payload
 * and dispatches it back to the agent.
 *
 * Mirrors the AG-UI A2UI action shape: an event name + optional
 * structured context.
 */
export interface ActionPayload {
  event: { name: string; context?: Record<string, unknown> };
}

/**
 * Props passed to a Slack renderer for a single component instance.
 * The render function receives:
 *
 *   - `props` — fully-resolved component props. Path bindings
 *     (`{ path: "..." }`) and child-list bindings
 *     (`{ componentId, path }`) have been resolved by `@a2ui/web_core`'s
 *     `GenericBinder` before this render runs.
 *   - `children(id, basePath?)` — render a child component by id and
 *     return its `KnownBlock[]`. The `basePath` parameter is for
 *     structural components iterating over a data-bound array (the
 *     binder hands the renderer the per-item ids + base paths via
 *     `props.children`).
 *   - `dispatch.encodeAction(action)` — pack an `ActionPayload` into
 *     a `button.value`-safe string. The bridge decodes this on
 *     `block_actions` and re-emits as
 *     `forwardedProps.a2uiAction.userAction`.
 */
export interface RendererProps<T = Record<string, unknown>> {
  props: T;
  /**
   * The web_core component context for this render. Provides access
   * to the raw `componentModel.properties` (pre-binder), the
   * `dataContext` (for ad-hoc path resolution), and
   * `dispatchAction(action)` for components that DO want to dispatch
   * actions synchronously rather than encode them for later click
   * round-trip. Most slack renderers won't need this — but Button-like
   * components reach in via `context.componentModel.properties.action`
   * to recover the raw `{ event: { name, context } }` shape, because
   * `props.action` after binding is a callable `() => void`, not the
   * raw payload `dispatch.encodeAction` wants.
   */
  context: ComponentContext;
  children: (id: string, basePath?: string) => KnownBlock[];
  dispatch?: { encodeAction(action: ActionPayload): EncodedAction };
}

/** A single Slack renderer: resolved props → Block Kit blocks. */
export type ComponentRenderer<T = Record<string, unknown>> = (
  rp: RendererProps<T>,
) => KnownBlock[];

/**
 * The renderers for a catalog — one per component name. TypeScript
 * enforces that every component named in `definitions` has a renderer
 * with matching prop types.
 *
 * Renderers receive **resolved** props (the binder has substituted
 * `{ path }` with concrete values, callable actions, child arrays).
 * The generic `ResolveA2uiProps` from `@a2ui/web_core` describes
 * this resolved shape, but in practice the binder hands you primitives
 * and callable closures where the schema had DynamicValue / Action
 * types.
 */
export type CatalogRenderers<D extends CatalogDefinitions> = {
  [K in keyof D]: ComponentRenderer<ResolveA2uiProps<z.infer<D[K]["props"]>>>;
};

/**
 * Internal-only: a Slack-side component implementation that web_core's
 * `MessageProcessor` understands. We assemble these from the user's
 * `(definitions, renderers)` pair and ship them inside a web_core
 * `Catalog`. Consumers don't construct this directly.
 */
export interface SlackComponentImplementation extends ComponentApi {
  render: (args: {
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => KnownBlock[];
    dispatch?: { encodeAction(action: ActionPayload): EncodedAction };
  }) => KnownBlock[];
}

/**
 * Re-export `ComponentApi` for callers that want to use web_core's
 * generic types alongside our Slack-host shape.
 */
export type { ComponentApi, InferredComponentApiSchemaType, ResolveA2uiProps };

/**
 * The assembled catalog. Passed to `createA2UIActivityRenderer` (or
 * the bridge config via `renderActivityMessages`). Carries:
 *
 *   - `catalogId` — matches `a2ui.create_surface(catalog_id=…)` on
 *     the agent side; routes incoming surfaces to this catalog.
 *   - `definitions` — exposed for tooling (e.g. schema-context).
 *   - `renderers` — exposed mostly for tests; the bridge consumes
 *     `_a2uiCatalog` at render time.
 *   - `_a2uiCatalog` — internal `@a2ui/web_core` `Catalog` carrying
 *     the wrapped renderers. Use at your own risk; the bridge reads
 *     it via `getInternalCatalog` (see `create-catalog.ts`).
 */
export interface Catalog<D extends CatalogDefinitions = CatalogDefinitions> {
  readonly catalogId: string;
  readonly definitions: D;
  readonly renderers: CatalogRenderers<D>;
  /** @internal — used by the bridge's render pipeline. */
  readonly _a2uiCatalog: A2UICatalog<SlackComponentImplementation>;
}
