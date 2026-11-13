import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * TanStack AI reads the JSON Schema of a tool or an output schema from
 * `~standard.jsonSchema`, which zod adds only from v4.2. The monorepo pins
 * zod 3, so this adds it. The schema keeps its zod types.
 */
export function withJsonSchema<T>(schema: T): T {
  const standard = (schema as { "~standard"?: Record<string, unknown> })?.[
    "~standard"
  ];
  if (standard?.vendor === "zod" && !standard.jsonSchema) {
    const toJson = () =>
      zodToJsonSchema(schema as z.ZodTypeAny, { $refStrategy: "none" });
    standard.jsonSchema = { input: toJson, output: toJson };
  }
  return schema;
}
