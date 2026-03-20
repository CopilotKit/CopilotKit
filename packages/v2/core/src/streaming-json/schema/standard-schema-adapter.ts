// Based on design from hashbrown/packages/core/src/schema/standard-json-schema.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Adapter that converts StandardSchemaV1 (e.g., Zod) JSON Schema output
 * into the internal schema types used by the streaming JSON parser.
 *
 * This bridges CopilotKit's public StandardSchemaV1 API with the ported
 * Hashbrown schema internals.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  SchemaType,
  StringType,
  NumberType,
  BooleanType,
  IntegerType,
  ObjectType,
  ArrayType,
  AnyOfType,
  NullType,
  EnumType,
  LiteralType,
  string,
  number,
  boolean,
  integer,
  object,
  array,
  anyOf,
  nullish,
  enumeration,
  literal,
} from './base';
import * as streaming from './streaming';

/**
 * A minimal JSON Schema shape, enough to convert into internal schema types.
 */
interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  enum?: any[];
  const?: any;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchemaNode;
}

/**
 * Convert a JSON Schema node into an internal SchemaType.
 *
 * @param jsonSchema - A JSON Schema object (typically from `zodToJsonSchema` or StandardSchemaV1)
 * @param options - Optional configuration for streaming behavior
 * @returns An internal SchemaType that can be used with `fromJsonAst`
 */
export function fromJsonSchema(
  jsonSchema: JsonSchemaNode,
  options?: { streaming?: boolean },
): SchemaType {
  const desc = jsonSchema.description ?? '';
  const isStreaming = options?.streaming ?? false;

  // Handle const (literal)
  if (jsonSchema.const !== undefined) {
    if (typeof jsonSchema.const === 'string') {
      return literal(jsonSchema.const);
    }
    // For non-string constants, fall through to type-based handling
  }

  // Handle enum
  if (jsonSchema.enum !== undefined) {
    const entries = jsonSchema.enum.filter((e): e is string => typeof e === 'string');
    if (entries.length > 0) {
      return enumeration(desc, entries);
    }
  }

  // Handle anyOf / oneOf
  if (jsonSchema.anyOf || jsonSchema.oneOf) {
    const variants = (jsonSchema.anyOf ?? jsonSchema.oneOf)!;
    const converted = variants.map((v) => fromJsonSchema(v, options));
    return anyOf(converted);
  }

  // Handle type arrays (e.g., ["string", "null"])
  if (Array.isArray(jsonSchema.type)) {
    const types = jsonSchema.type;
    const variants: SchemaType[] = [];
    for (const t of types) {
      variants.push(fromJsonSchema({ ...jsonSchema, type: t }, options));
    }
    return anyOf(variants);
  }

  // Handle single types
  switch (jsonSchema.type) {
    case 'string':
      if (isStreaming) {
        return streaming.string(desc, {
          pattern: jsonSchema.pattern,
          format: jsonSchema.format as any,
        });
      }
      return string(desc, {
        pattern: jsonSchema.pattern,
        format: jsonSchema.format as any,
      });

    case 'number':
      return number(desc, {
        minimum: jsonSchema.minimum,
        maximum: jsonSchema.maximum,
        exclusiveMinimum: jsonSchema.exclusiveMinimum,
        exclusiveMaximum: jsonSchema.exclusiveMaximum,
        multipleOf: jsonSchema.multipleOf,
      });

    case 'integer':
      return integer(desc, {
        minimum: jsonSchema.minimum,
        maximum: jsonSchema.maximum,
        exclusiveMinimum: jsonSchema.exclusiveMinimum,
        exclusiveMaximum: jsonSchema.exclusiveMaximum,
        multipleOf: jsonSchema.multipleOf,
      });

    case 'boolean':
      return boolean(desc);

    case 'null':
      return nullish();

    case 'object': {
      const properties = jsonSchema.properties ?? {};
      const shape: Record<string, SchemaType> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        shape[key] = fromJsonSchema(propSchema, options);
      }
      if (isStreaming) {
        return streaming.object(desc, shape);
      }
      return object(desc, shape);
    }

    case 'array': {
      const itemSchema = jsonSchema.items
        ? fromJsonSchema(jsonSchema.items, options)
        : string('item');
      if (isStreaming) {
        return streaming.array(desc, itemSchema, {
          minItems: jsonSchema.minItems,
          maxItems: jsonSchema.maxItems,
        });
      }
      return array(desc, itemSchema, {
        minItems: jsonSchema.minItems,
        maxItems: jsonSchema.maxItems,
      });
    }

    default:
      // If type is missing but properties exist, treat as object
      if (jsonSchema.type === undefined && jsonSchema.properties) {
        const properties = jsonSchema.properties;
        const shape: Record<string, SchemaType> = {};
        for (const [key, propSchema] of Object.entries(properties)) {
          shape[key] = fromJsonSchema(propSchema, options);
        }
        if (isStreaming) {
          return streaming.object(desc, shape);
        }
        return object(desc, shape);
      }

      // Fallback: warn and return a string schema for unknown types
      console.warn(
        `[fromJsonSchema] Unknown or unsupported JSON Schema type: ${JSON.stringify(jsonSchema.type)}. ` +
        `Falling back to string schema. Full schema: ${JSON.stringify(jsonSchema)}`,
      );
      return string(desc);
  }
}

/**
 * Convert a StandardSchemaV1-compatible schema to an internal SchemaType.
 *
 * This works by first extracting JSON Schema from the standard schema,
 * then converting that JSON Schema into internal types.
 *
 * @param standardSchema - A StandardSchemaV1-compatible schema (e.g., Zod)
 * @param jsonSchema - Pre-extracted JSON Schema (if you already have it)
 * @param options - Optional configuration for streaming behavior
 * @returns An internal SchemaType
 */
export function fromStandardSchema(
  jsonSchema: Record<string, unknown>,
  options?: { streaming?: boolean },
): SchemaType {
  return fromJsonSchema(jsonSchema as JsonSchemaNode, options);
}
