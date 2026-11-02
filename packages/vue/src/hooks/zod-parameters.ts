import { z } from "zod";
import { actionParametersToJsonSchema } from "@copilotkit/shared";
import type { Parameter } from "@copilotkit/shared";

/**
 * Convert a JSON Schema to a Zod schema. Resolves `$ref` against `$defs` /
 * `definitions`, maps `anyOf` / `oneOf` to unions, and falls back to
 * `z.any()` for circular refs and unsupported types.
 *
 * Moved here from `@copilotkit/shared` in 2.0 so that shared does not depend
 * on zod.
 */
export function convertJsonSchemaToZodSchema(
  jsonSchema: any,
  required: boolean,
  definitions?: Record<string, any>,
  visitedRefs?: Set<string>,
): z.ZodSchema {
  // Resolve $ref references
  if (jsonSchema.$ref && definitions) {
    const refPath = jsonSchema.$ref.replace(
      /^#\/\$defs\/|^#\/definitions\//,
      "",
    );

    // Detect circular $ref cycles
    const refs = visitedRefs ?? new Set<string>();
    if (refs.has(refPath)) {
      console.warn(
        `[CopilotKit] Circular $ref detected for "${refPath}" — falling back to z.any()`,
      );
      let schema = z.any();
      if (jsonSchema.description) {
        schema = schema.describe(jsonSchema.description);
      }
      return required ? schema : schema.optional();
    }

    const resolved = definitions[refPath];
    if (resolved) {
      // Clone the set so sibling branches don't see each other's visited refs
      const nextRefs = new Set(refs);
      nextRefs.add(refPath);
      return convertJsonSchemaToZodSchema(
        resolved,
        required,
        definitions,
        nextRefs,
      );
    }
  }

  // Collect top-level definitions for $ref resolution
  const defs = definitions ?? jsonSchema.$defs ?? jsonSchema.definitions;

  // Handle null-union types like ["string", "null"]
  if (Array.isArray(jsonSchema.type)) {
    const types = jsonSchema.type as string[];
    const hasNull = types.includes("null");
    const nonNullTypes = types.filter((t: string) => t !== "null");
    const resolvedType = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
    const innerSchema = convertJsonSchemaToZodSchema(
      { ...jsonSchema, type: resolvedType },
      true,
      defs,
      visitedRefs,
    );
    let schema = hasNull ? z.union([innerSchema, z.null()]) : innerSchema;
    if (jsonSchema.description) {
      schema = schema.describe(jsonSchema.description);
    }
    return required ? schema : schema.optional();
  }

  // Handle anyOf / oneOf as z.union
  const unionVariants = jsonSchema.anyOf ?? jsonSchema.oneOf;
  if (Array.isArray(unionVariants) && unionVariants.length > 0) {
    if (unionVariants.length === 1) {
      return convertJsonSchemaToZodSchema(
        unionVariants[0],
        required,
        defs,
        visitedRefs,
      );
    }
    const schemas = unionVariants.map((v: any) =>
      convertJsonSchemaToZodSchema(v, true, defs, visitedRefs),
    );
    let schema = z.union(
      schemas as [z.ZodSchema, z.ZodSchema, ...z.ZodSchema[]],
    );
    if (jsonSchema.description) {
      schema = schema.describe(jsonSchema.description);
    }
    return required ? schema : schema.optional();
  }

  if (jsonSchema.type === "object") {
    const spec: { [key: string]: z.ZodSchema } = {};

    if (!jsonSchema.properties || !Object.keys(jsonSchema.properties).length) {
      return !required ? z.object(spec).optional() : z.object(spec);
    }

    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      spec[key] = convertJsonSchemaToZodSchema(
        value,
        jsonSchema.required ? jsonSchema.required.includes(key) : false,
        defs,
        visitedRefs,
      );
    }
    let schema = z.object(spec).describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    if (jsonSchema.enum && jsonSchema.enum.length > 0) {
      let schema = z
        .enum(jsonSchema.enum as [string, ...string[]])
        .describe(jsonSchema.description);
      return required ? schema : schema.optional();
    }
    let schema = z.string().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    let schema = z.number().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    let schema = z.boolean().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    let itemSchema = convertJsonSchemaToZodSchema(
      jsonSchema.items,
      true,
      defs,
      visitedRefs,
    );
    let schema = z.array(itemSchema).describe(jsonSchema.description);
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "null") {
    let schema = z.null().describe(jsonSchema.description);
    return required ? schema : schema.optional();
  }

  // Fallback: accept any value rather than throwing
  console.warn(
    `[CopilotKit] Unsupported JSON schema type "${jsonSchema.type ?? "unknown"}" — falling back to z.any()`,
  );
  let schema = z.any();
  if (jsonSchema.description) {
    schema = schema.describe(jsonSchema.description);
  }
  return required ? schema : schema.optional();
}

/** Convert v1 `Parameter[]` action parameters to a Zod object schema. */
export function getZodParameters<T extends [] | Parameter[] | undefined>(
  parameters: T,
): any {
  if (!parameters) return z.object({});
  const jsonParams = actionParametersToJsonSchema(parameters);
  return convertJsonSchemaToZodSchema(jsonParams, true);
}
