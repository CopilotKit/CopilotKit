import type {
  StandardSchemaV1,
  StandardJSONSchemaV1,
} from "@standard-schema/spec";

export type { StandardSchemaV1, StandardJSONSchemaV1 };

/**
 * A Standard Schema that accepts any value and returns it unchanged.
 *
 * Wildcard tool call renderers use it when they declare no `args` schema.
 *
 * @internal Application authors must not depend on this contract.
 */
export const ɵanySchema: StandardSchemaV1<unknown, unknown> = {
  "~standard": {
    version: 1,
    vendor: "copilotkit",
    validate: (value) => ({ value }),
  },
};

/**
 * Extract the Output type from a StandardSchemaV1 schema.
 * Replaces `z.infer<S>` for generic schema inference.
 */
export type InferSchemaOutput<S> =
  S extends StandardSchemaV1<any, infer O> ? O : never;

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
 *    Zod 4.2+, ArkType 2.1.28+ and Valibot (via `toStandardJsonSchema`) do.
 * 2. If the schema exposes a `toJSONSchema()` method, call it directly.
 * 3. Otherwise throw a descriptive error. Zod 3 schemas land here: they
 *    implement Standard Schema validation but cannot describe themselves as
 *    JSON Schema.
 */
export function schemaToJsonSchema(
  schema: StandardSchemaV1,
): Record<string, unknown> {
  // 1. Standard JSON Schema V1
  if (hasStandardJsonSchema(schema)) {
    return schema["~standard"].jsonSchema.input({ target: "draft-07" });
  }

  // 2. Native toJSONSchema() method
  if (typeof (schema as any).toJSONSchema === "function") {
    return (schema as any).toJSONSchema() as Record<string, unknown>;
  }

  const vendor = schema["~standard"].vendor;
  throw new Error(
    `Cannot convert schema to JSON Schema. The schema (vendor: "${vendor}") does not implement Standard JSON Schema V1. ` +
      `Use a library that does: Zod 4.2+ (Zod 3 is not supported), Valibot v1+ wrapped with ` +
      `toStandardJsonSchema() from @valibot/to-json-schema, or ArkType v2.1.28+.`,
  );
}
