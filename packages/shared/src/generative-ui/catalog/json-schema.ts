import { schemaToJsonSchema } from "../../standard-schema";
import { applyChildRefMarks } from "../base";
import type { StandardSchemaV1 } from "../../standard-schema";
import type { GenerativeUIJSONSchema } from "../base";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * JSON Schema for a Standard Schema (zod v3 via zod-to-json-schema),
 * inlined, no `$schema`. A prop marked by `child()` or `childList()`
 * becomes an A2UI `$ref` to `ComponentId` or `ChildList`.
 */
export function toJsonSchema(schema: StandardSchemaV1): GenerativeUIJSONSchema {
  const json = schemaToJsonSchema(schema, {
    // The cast through the parameter type keeps TypeScript from expanding
    // the zod type, which is "excessively deep" in this package.
    zodToJsonSchema: (s: unknown) =>
      zodToJsonSchema(s as Parameters<typeof zodToJsonSchema>[0], {
        $refStrategy: "none",
      }) as Record<string, unknown>,
  });
  const { $schema: _omit, ...rest } = json as Record<string, unknown>;
  return applyChildRefMarks(rest);
}
