import type { FormField, FormSchema } from "./types";

/**
 * Minimal JSON Schema subset used by this converter.
 *
 * MVP scope: only plain `type` + `properties` + `items` + `enum` trees as
 * produced by `zod-to-json-schema` for simple Zod schemas. Not supported:
 * - `$ref` (no reference resolution / cycle detection)
 * - Tuple-style `items: JSONSchemaNode[]`
 * - `allOf` / `anyOf` / `oneOf`
 * These all fall through to the raw-json fallback.
 */
export interface JSONSchemaNode {
  type?: string;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, JSONSchemaNode>;
  required?: string[];
  items?: JSONSchemaNode;
}

function propertyToField(
  name: string,
  node: JSONSchemaNode,
  required: boolean,
): FormField {
  const base = { name, label: name, required, description: node.description };

  if (node.type === "string") {
    const en = node.enum?.every((v) => typeof v === "string")
      ? (node.enum as string[])
      : undefined;
    return { kind: "string", ...base, enum: en };
  }
  if (node.type === "number" || node.type === "integer") {
    return { kind: "number", ...base };
  }
  if (node.type === "boolean") return { kind: "boolean", ...base };
  if (node.type === "object") {
    const req = new Set(node.required ?? []);
    return {
      kind: "object",
      ...base,
      fields: Object.entries(node.properties ?? {}).map(([k, v]) =>
        propertyToField(k, v, req.has(k)),
      ),
    };
  }
  if (node.type === "array" && node.items) {
    return {
      kind: "array",
      ...base,
      items: propertyToField("item", node.items, true),
    };
  }
  return {
    kind: "raw-json",
    ...base,
    hint: `Unsupported JSON Schema type "${node.type ?? "(none)"}"; edit as JSON.`,
  };
}

export function jsonSchemaToFormSchema(
  schema: JSONSchemaNode | undefined,
): FormSchema {
  if (!schema || schema.type !== "object") return { fields: [] };
  const required = new Set(schema.required ?? []);
  return {
    fields: Object.entries(schema.properties ?? {}).map(([k, v]) =>
      propertyToField(k, v, required.has(k)),
    ),
  };
}
