import { toJsonSchema } from "../standard-schema.js";
import type { Catalog } from "./types.js";
import type { SlackContextEntry } from "../frontend-tools.js";

/**
 * AG-UI `@ag-ui/a2ui-middleware` looks for context entries whose
 * `description` is this exact string and treats their `value` as the
 * A2UI catalog schema available to the agent.
 *
 * Kept inline (not imported) so consumers don't pull the middleware
 * onto their runtime classpath unnecessarily — this is a literal
 * string identity, not a code dependency.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

/**
 * Build a context entry that advertises one or more A2UI catalogs to
 * the agent's secondary LLM, in the v0.9 inline-catalog format the
 * middleware (and the agent prompts) expect.
 *
 * Wire format the middleware ships:
 *
 *     { a2ui: { schemas: [ A2UIInlineCatalogSchema, ... ] } }
 *
 * Each `A2UIInlineCatalogSchema` is `{ catalogId, components }` where
 * `components` is a record keyed by component name. The VALUE for
 * each component is the JSON Schema of its **flat** props
 * (NO nested `props` wrapper) — this is critical because the
 * secondary LLM mirrors the schema's shape in the components it
 * emits, and the v0.9 wire format expects props as siblings of
 * `id`/`component`. The legacy `[{name, props: schema}]` format
 * biases the LLM toward emitting `{id, component, props: {...}}`,
 * which `@a2ui/web_core`'s parser rejects.
 */
export function a2uiSchemaContext(
  catalogs: ReadonlyArray<Catalog>,
): SlackContextEntry {
  const schemas = catalogs.map((c) => {
    const components: Record<string, Record<string, unknown>> = {};
    for (const [name, def] of Object.entries(c.definitions)) {
      const schema = toJsonSchema(def.props);
      // Inject the description into the JSON-schema-level description
      // field so the LLM sees the per-component prose alongside the
      // structural shape.
      if (def.description) {
        schema["description"] = def.description;
      }
      components[name] = schema;
    }
    return { catalogId: c.catalogId, components };
  });
  return {
    description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
    value: JSON.stringify({ a2ui: { schemas } }),
  };
}
