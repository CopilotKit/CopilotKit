import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * A single component definition — Zod props schema + optional description.
 * Matches CatalogComponentDefinition from @copilotkit/a2ui-renderer.
 */
export interface ComponentDefinition {
  props: z.ZodObject<any>;
  description?: string;
}

/**
 * Extract a JSON-serializable schema from catalog definitions.
 *
 * Converts Zod schemas to JSON Schema using zod-to-json-schema.
 * Suitable for passing to CopilotRuntime's `a2ui.schema` config,
 * which the middleware injects as context for agents.
 *
 * @example
 * ```ts
 * import { extractCatalogSchema } from "@copilotkit/shared";
 * import { myCatalogDefinitions } from "./definitions";
 *
 * const schema = extractCatalogSchema(myCatalogDefinitions);
 *
 * new CopilotRuntime({
 *   a2ui: { schema },
 * });
 * ```
 */
export function extractCatalogSchema(
  definitions: Record<string, ComponentDefinition>,
): Array<{
  name: string;
  description?: string;
  props: Record<string, unknown>;
}> {
  return Object.entries(definitions).map(([name, def]) => ({
    name,
    description: def.description,
    props: zodToJsonSchema(def.props, { target: "openApi3" }) as Record<
      string,
      unknown
    >,
  }));
}
