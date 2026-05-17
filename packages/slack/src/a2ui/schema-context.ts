import { zodToJsonSchema } from "zod-to-json-schema";
import type { Catalog } from "./types.js";
import type { SlackContextEntry } from "../frontend-tools.js";

/**
 * AG-UI `@ag-ui/a2ui-middleware` looks for context entries whose
 * `description` is this exact string and treats their `value` as the
 * A2UI catalog schema available to the agent. Constant mirrored from
 * `A2UI_SCHEMA_CONTEXT_DESCRIPTION` in the middleware's d.mts.
 *
 * Kept inline (not imported) because importing pulls the middleware
 * onto every consumer's runtime classpath unnecessarily — this is a
 * literal string identity, not a code dependency.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

/**
 * Build a context entry that advertises one or more A2UI catalogs to
 * the agent. Pass the result through `createSlackBridge({ context })`
 * (alongside `defaultSlackContext`):
 *
 *     context: [
 *       ...defaultSlackContext,
 *       a2uiSchemaContext([flightCatalog, dashboardCatalog]),
 *     ],
 *
 * This is required for the **dynamic-schema** A2UI mode — the
 * agent's secondary LLM uses these component names + props to
 * generate surfaces. Fixed-schema agents don't strictly need it
 * (they ship the schema as JSON), but providing it costs little and
 * keeps the agent honest if it ever invents a free-form component.
 *
 * `zod-to-json-schema` is used to flatten each component's prop
 * Zod schema into a stable JSON Schema the LLM can read.
 */
export function a2uiSchemaContext(
  catalogs: ReadonlyArray<Catalog>,
): SlackContextEntry {
  const schemas = catalogs.flatMap((c) =>
    Object.entries(c.definitions).map(([name, def]) => ({
      catalogId: c.catalogId,
      name,
      description: def.description,
      props: zodToJsonSchema(def.props as any),
    })),
  );
  return {
    description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
    value: JSON.stringify({ a2ui: { schemas } }),
  };
}
