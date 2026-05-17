import type { KnownBlock } from "@slack/types";
import type { z, ZodObject, ZodRawShape } from "zod";

/**
 * A2UI catalog primitives — the Slack-package analogue of
 * `@copilotkit/a2ui-renderer`'s `CatalogDefinitions` / `CatalogRenderers` /
 * `createCatalog`, with two key differences:
 *
 *   1. Renderers return `KnownBlock[]` (Slack Block Kit) instead of
 *      ReactNode.
 *   2. The assembled catalog is a plain tagged record — not the
 *      `@a2ui/web_core` `Catalog` class. The bridge looks up renderers
 *      by component name, resolves data-model path bindings, and posts
 *      the resulting blocks via `chat.postMessage`.
 *
 * `CatalogDefinitions` is intentionally platform-agnostic — apps can
 * (and should) share the same definitions module between a web frontend
 * and the Slack bot.
 */

/**
 * A single component definition — Zod props schema + optional
 * description. Platform-agnostic: no rendering details.
 */
export interface CatalogComponentDefinition<
  T extends ZodRawShape = ZodRawShape,
> {
  /** Zod schema for the component's props. */
  props: ZodObject<T>;
  /** Human-readable description shown to the agent so it picks well. */
  description?: string;
}

/**
 * A record mapping component names to their definitions. This is the
 * platform-agnostic contract that the agent receives as schema context.
 */
export type CatalogDefinitions = Record<
  string,
  CatalogComponentDefinition<any>
>;

/**
 * Infer the props type for a specific component in a definitions
 * record. Useful when writing custom adapters over a catalog.
 */
export type PropsOf<D extends CatalogDefinitions, K extends keyof D> = z.infer<
  D[K]["props"]
>;

/**
 * Encoded action — a string ≤ 2000 chars suitable for Slack
 * `button.value`. Produced by `RendererProps.dispatch.encodeAction`.
 * The bridge decodes this on `block_actions` events to know which
 * a2ui action to dispatch back to the agent.
 *
 * Same approach as the HITL / interrupt picker payloads — Slack caps
 * `button.value` at 2000 chars, so renderers MUST keep encoded payloads
 * compact (don't embed the full data model — just a stable key /
 * reference).
 */
export type EncodedAction = string;

/**
 * The structured a2ui action shape — what renderers describe when a
 * user interacts with a Button (or other actionable). The bridge
 * translates this back into an a2ui dispatch when the user clicks.
 *
 * Mirrors the AG-UI a2ui `dispatchAction` payload shape: a named event
 * plus optional structured context.
 */
export interface ActionPayload {
  event: { name: string; context?: Record<string, unknown> };
}

/**
 * Props passed to a Slack renderer function for a single component
 * instance.
 *
 *   - `props` — the resolved prop values. Path bindings
 *     (`{ path: "..." }`) are already resolved against the surface's
 *     data model by the bridge before the renderer runs.
 *   - `children(id, basePath?)` — render a child component by id,
 *     returning its `KnownBlock[]`. Use this for structural components
 *     (Row, Column, Card) that nest other components.
 *   - `dispatch.encodeAction(action)` — pack a structured action into
 *     a `button.value`-safe string. Use this on interactive elements;
 *     the bridge decodes it on `block_actions` and dispatches the
 *     action back to the agent. Absent on non-interactive surfaces.
 */
export interface RendererProps<T = Record<string, unknown>> {
  props: T;
  children: (id: string, basePath?: string) => KnownBlock[];
  dispatch?: { encodeAction(action: ActionPayload): EncodedAction };
}

/**
 * A single Slack renderer: takes resolved props (+ child / dispatch
 * helpers) and returns the Block Kit blocks for that component
 * instance. Pure — no side effects, no posting; the bridge handles
 * delivery.
 */
export type ComponentRenderer<T = Record<string, unknown>> = (
  rp: RendererProps<T>,
) => KnownBlock[];

/**
 * The renderers for a catalog — one per component name. TypeScript
 * enforces that every component named in `definitions` has a renderer
 * with matching prop types.
 */
export type CatalogRenderers<D extends CatalogDefinitions> = {
  [K in keyof D]: ComponentRenderer<z.infer<D[K]["props"]>>;
};

/**
 * The assembled catalog — the thing passed to `createSlackBridge` via
 * `{ a2ui: { catalog } }`. Just a tagged record: the catalog ID (for
 * routing a2ui events to this catalog), the definitions (sent to the
 * agent as schema context), and the renderers (used by the bridge to
 * produce Block Kit at render time).
 */
export interface Catalog<D extends CatalogDefinitions = CatalogDefinitions> {
  readonly catalogId: string;
  readonly definitions: D;
  readonly renderers: CatalogRenderers<D>;
}
