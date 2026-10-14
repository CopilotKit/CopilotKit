import { schemaToJsonSchema } from "@copilotkit/shared";
import type {
  GenerativeUIJSONSchema,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/** JSON Schema for a Standard Schema (zod v3 via zod-to-json-schema), inlined, no `$schema`. */
export function toJsonSchema(schema: StandardSchemaV1): GenerativeUIJSONSchema {
  const json = schemaToJsonSchema(schema, {
    zodToJsonSchema: (s: unknown) =>
      zodToJsonSchema(s as z.ZodType, { $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
  });
  const { $schema: _omit, ...rest } = json as Record<string, unknown>;
  return rest;
}
