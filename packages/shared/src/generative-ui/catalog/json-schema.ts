import { schemaToJsonSchema } from "../../standard-schema";
import { applyChildRefMarks } from "../base";
import type { StandardSchemaV1 } from "../../standard-schema";
import type { GenerativeUIJSONSchema } from "../base";

/**
 * JSON Schema for a Standard Schema, without `$schema`. A prop marked by `child()` or `childList()`
 * becomes an A2UI `$ref` to `ComponentId` or `ChildList`.
 */
export function toJsonSchema(schema: StandardSchemaV1): GenerativeUIJSONSchema {
  const json = schemaToJsonSchema(schema);
  const { $schema: _omit, ...rest } = json as Record<string, unknown>;
  return applyChildRefMarks(rest);
}
