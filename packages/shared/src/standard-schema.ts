import type {
  StandardSchemaV1,
  StandardJSONSchemaV1,
} from "@standard-schema/spec";

export type { StandardSchemaV1, StandardJSONSchemaV1 };

/**
 * Extract the Output type from a StandardSchemaV1 schema.
 * Replaces `z.infer<S>` for generic schema inference.
 */
export type InferSchemaOutput<S> =
  S extends StandardSchemaV1<any, infer O> ? O : never;

export interface SchemaToJsonSchemaOptions {
  /**
   * Injected `zodToJsonSchema` function so that `shared` does not depend on
   * `zod-to-json-schema`. Required when the schema is a Zod v3 schema that
   * does not implement Standard JSON Schema V1.
   */
  zodToJsonSchema?: (
    schema: unknown,
    options?: { $refStrategy?: string },
  ) => Record<string, unknown>;
}

/**
 * Check whether a schema implements the Standard JSON Schema V1 protocol.
 */
function hasStandardJsonSchema(
  schema: StandardSchemaV1,
): schema is StandardSchemaV1 & StandardJSONSchemaV1 {
  const props = schema["~standard"];
  return (
    props != null &&
    typeof props === "object" &&
    "jsonSchema" in props &&
    props.jsonSchema != null &&
    typeof props.jsonSchema === "object" &&
    "input" in props.jsonSchema &&
    typeof props.jsonSchema.input === "function"
  );
}

/**
 * Convert any StandardSchemaV1-compatible schema to a JSON Schema object.
 *
 * Strategy:
 * 1. If the schema implements Standard JSON Schema V1 (`~standard.jsonSchema`),
 *    call `schema['~standard'].jsonSchema.input({ target: 'draft-07' })`.
 * 2. If the schema exposes a `toJSONSchema()` method (Zod v4), call it directly.
 * 3. If the schema is a Zod v3 schema (`~standard.vendor === 'zod'`), use the
 *    injected `zodToJsonSchema()` function.
 * 4. Otherwise throw a descriptive error.
 */
export function schemaToJsonSchema(
  schema: StandardSchemaV1,
  options?: SchemaToJsonSchemaOptions,
): Record<string, unknown> {
  // 1. Standard JSON Schema V1
  if (hasStandardJsonSchema(schema)) {
    return schema["~standard"].jsonSchema.input({ target: "draft-07" });
  }

  // 2. Zod v4 native — exposes toJSONSchema() on the schema itself
  if (typeof (schema as any).toJSONSchema === "function") {
    return (schema as any).toJSONSchema() as Record<string, unknown>;
  }

  // 3. Zod v3 fallback
  const vendor = schema["~standard"].vendor;
  if (vendor === "zod" && options?.zodToJsonSchema) {
    return options.zodToJsonSchema(schema, { $refStrategy: "none" });
  }

  throw new Error(
    `Cannot convert schema to JSON Schema. The schema (vendor: "${vendor}") does not implement Standard JSON Schema V1 ` +
      `and no zodToJsonSchema fallback is available. ` +
      `Use a library that supports Standard JSON Schema (e.g., Zod 3.24+, Valibot v1+, ArkType v2+) ` +
      `or pass a zodToJsonSchema function in options.`,
  );
}
