/**
 * Extract JSON-serializable schema from catalog definitions.
 *
 * Converts Zod schemas to a format suitable for the A2UI middleware.
 * This is a server-safe utility (no React dependencies).
 */

import { z } from "zod";

export function extractCatalogSchema(
  definitions: Record<
    string,
    { props: z.ZodObject<any>; description?: string }
  >,
): Array<{
  name: string;
  description?: string;
  props: Record<string, unknown>;
}> {
  return Object.entries(definitions).map(([name, def]) => ({
    name,
    description: def.description,
    props: zodToJsonSchema(def.props),
  }));
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def;
  const typeName = def?.typeName;

  switch (typeName) {
    case "ZodString":
      return {
        type: "string",
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodNumber":
      return {
        type: "number",
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodBoolean":
      return {
        type: "boolean",
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault":
      return zodToJsonSchema(def.innerType);
    case "ZodArray":
      return {
        type: "array",
        items: zodToJsonSchema(def.type),
        ...(schema.description ? { description: schema.description } : {}),
      };
    case "ZodObject": {
      const shape = (schema as z.ZodObject<any>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
        if ((value as any)._def?.typeName !== "ZodOptional") {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        ...(schema.description ? { description: schema.description } : {}),
      };
    }
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: zodToJsonSchema(def.valueType),
      };
    case "ZodAny":
      return {};
    default:
      return { type: "string" };
  }
}
