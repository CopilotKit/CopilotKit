import { RENDER_A2UI_TOOL } from "@ag-ui/a2ui-middleware";
import type { RunAgentInput } from "@ag-ui/client";
import { Validator } from "@cfworker/json-schema";
import { schemaToJsonSchema } from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { jsonSchema as aiJsonSchema, tool as createVercelAISDKTool } from "ai";
import type { Schema, ToolSet } from "ai";
import { z } from "zod";
import type { ToolDefinition } from "../agent";

/**
 * JSON Schema type definition
 */
interface JsonSchema {
  type?:
    | "object"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  // Union combinators. A frontend tool authored with `z.discriminatedUnion`
  // (or any `z.union`) serializes to a node carrying `anyOf` / `oneOf` and
  // usually NO top-level `type`.
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

/**
 * Converts JSON Schema to Zod schema
 */
export function convertJsonSchemaToZodSchema(
  jsonSchema: JsonSchema,
  required: boolean,
): z.ZodSchema {
  if (jsonSchema.type === "null") {
    const schema = z.null().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  }

  // Handle `anyOf` / `oneOf` unions (e.g. `z.discriminatedUnion` or `z.union`
  // on a frontend tool) as `z.union`. These nodes usually carry no top-level
  // `type`, so they MUST be handled before the empty-schema guard below —
  // otherwise the union collapses to an empty object (`z.object({})`), the
  // reconstructed tool schema loses the union-typed field entirely, and the
  // model can never emit it. This is especially load-bearing for a union
  // nested inside array `items`, which OpenAI otherwise silently drops.
  const unionVariants = jsonSchema.anyOf ?? jsonSchema.oneOf;
  if (Array.isArray(unionVariants) && unionVariants.length > 0) {
    // A single-variant union is just that variant.
    if (unionVariants.length === 1) {
      return convertJsonSchemaToZodSchema(unionVariants[0], required);
    }
    const variantSchemas = unionVariants.map((variant) =>
      convertJsonSchemaToZodSchema(variant, true),
    );
    const schema = z
      .union(variantSchemas as [z.ZodSchema, z.ZodSchema, ...z.ZodSchema[]])
      .describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  }

  // Handle empty schemas {} (no input required) - treat as empty object
  if (!jsonSchema.type) {
    return required ? z.object({}) : z.object({}).optional();
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
      );
    }
    const schema = z.object(spec).describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "string") {
    if (jsonSchema.enum && jsonSchema.enum.length > 0) {
      const schema = z
        .enum(jsonSchema.enum as [string, ...string[]])
        .describe(jsonSchema.description ?? "");
      return required ? schema : schema.optional();
    }
    const schema = z.string().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    const schema = z.number().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "boolean") {
    const schema = z.boolean().describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  } else if (jsonSchema.type === "array") {
    if (!jsonSchema.items) {
      throw new Error("Array type must have items property");
    }
    const itemSchema = convertJsonSchemaToZodSchema(jsonSchema.items, true);
    const schema = z.array(itemSchema).describe(jsonSchema.description ?? "");
    return required ? schema : schema.optional();
  }
  console.error("Invalid JSON schema:", JSON.stringify(jsonSchema, null, 2));
  throw new Error("Invalid JSON schema");
}

/** Whether a value is a JSON Schema that `convertToolsToVercelAITools` accepts. */
function isJsonSchema(obj: unknown): obj is JsonSchema {
  if (typeof obj !== "object" || obj === null) return false;
  const schema = obj as Record<string, unknown>;
  // Empty objects {} are valid JSON schemas (no input required)
  if (Object.keys(schema).length === 0) return true;
  return (
    typeof schema.type === "string" &&
    ["object", "string", "number", "integer", "boolean", "array"].includes(
      schema.type,
    )
  );
}

/**
 * Type-only pass-through for handing a Zod schema to the AI SDK's `tool()`.
 * The raw Zod schema is returned unchanged at runtime — the SDK's `asSchema()`
 * converts and validates it internally exactly as before.
 *
 * The Zod type is erased through `unknown` deliberately: letting tsc relate
 * Zod schema types to the AI SDK's `FlexibleSchema` union (conditional types
 * spanning zod v3/v4) makes type instantiation explode (TS2589 / compiler
 * OOM) under this package's `moduleResolution: node`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toLanguageModelSchema(schema: z.ZodSchema): Schema<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return schema as unknown as Schema<any>;
}

/** Preserve AG-UI tool schemas when passing them to the model provider. */
export function convertToolsToVercelAITools(
  tools: RunAgentInput["tools"],
): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const tool of tools) {
    if (!isJsonSchema(tool.parameters)) {
      throw new Error(`Invalid JSON schema for tool ${tool.name}`);
    }
    const validator = new Validator(tool.parameters, "7");
    result[tool.name] = createVercelAISDKTool({
      description: tool.description,
      // AG-UI already supplies JSON Schema. A Zod round trip loses open object
      // fields (including A2UI components), references, and other constraints.
      inputSchema: aiJsonSchema(tool.parameters, {
        validate: (value) => {
          const result = validator.validate(value);
          return result.valid
            ? { success: true, value }
            : {
                success: false,
                error: new Error(`Invalid arguments for tool ${tool.name}`),
              };
        },
      }),
      // A2UI components require open objects. Other tools keep the provider's
      // existing strictness default instead of opting every tool out.
      ...(tool.name === RENDER_A2UI_TOOL.name ? { strict: false } : {}),
    });
  }

  return result;
}

/**
 * Check whether a schema is a Zod schema by inspecting its Standard Schema vendor.
 */
function isZodSchema(schema: StandardSchemaV1): boolean {
  return schema["~standard"]?.vendor === "zod";
}

/**
 * Converts ToolDefinition array to Vercel AI SDK ToolSet.
 *
 * For Zod schemas, passes them directly to the AI SDK (Zod satisfies FlexibleSchema).
 * For non-Zod schemas, converts to JSON Schema via schemaToJsonSchema() and wraps
 * with the AI SDK's jsonSchema() helper.
 */
export function convertToolDefinitionsToVercelAITools(
  tools: ToolDefinition[],
): ToolSet {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const tool of tools) {
    if (isZodSchema(tool.parameters)) {
      // Zod schemas can be passed directly to AI SDK (satisfies FlexibleSchema)
      result[tool.name] = createVercelAISDKTool({
        description: tool.description,
        inputSchema: tool.parameters as any,
        execute: tool.execute,
      });
    } else {
      // Non-Zod: convert to JSON Schema and wrap with AI SDK's jsonSchema()
      const jsonSchemaObj = schemaToJsonSchema(tool.parameters);
      result[tool.name] = createVercelAISDKTool({
        description: tool.description,
        inputSchema: aiJsonSchema(jsonSchemaObj),
        execute: tool.execute,
      });
    }
  }

  return result;
}
