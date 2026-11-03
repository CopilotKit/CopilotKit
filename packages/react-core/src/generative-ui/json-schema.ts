import { applyChildRefMarks, schemaToJsonSchema } from "@copilotkit/shared";
import type {
  GenerativeUIJSONSchema,
  StandardSchemaV1,
} from "@copilotkit/shared";

/**
 * JSON Schema for a Standard Schema, without `$schema`. A prop marked by `child()` or `childList()`
 * becomes an A2UI `$ref` to `ComponentId` or `ChildList`.
 */
export function toJsonSchema(schema: StandardSchemaV1): GenerativeUIJSONSchema {
  const json = schemaToJsonSchema(schema);
  const { $schema: _omit, ...rest } = json as Record<string, unknown>;
  return applyChildRefMarks(rest);
}
