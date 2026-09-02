import { schemaToJsonSchema } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { FrontendTool } from "../types";

/**
 * Empty tool schema constant
 */
const EMPTY_TOOL_SCHEMA = {
  type: "object",
  properties: {},
} as const satisfies Record<string, unknown>;

/**
 * Create a JSON schema from a tool's parameters
 */
export function createToolSchema(
  tool: FrontendTool<any>,
): Record<string, unknown> {
  if (!tool.parameters) {
    return { ...EMPTY_TOOL_SCHEMA };
  }

  const rawSchema = schemaToJsonSchema(tool.parameters, {
    zodToJsonSchema: (schema, options) =>
      zodToJsonSchema(
        schema as Parameters<typeof zodToJsonSchema>[0],
        options as Parameters<typeof zodToJsonSchema>[1],
      ),
  });

  if (!rawSchema || typeof rawSchema !== "object") {
    return { ...EMPTY_TOOL_SCHEMA };
  }

  const { $schema: _$schema, ...schema } = rawSchema as Record<string, unknown>;

  if (typeof schema.type !== "string") {
    schema.type = "object";
  }
  if (typeof schema.properties !== "object" || schema.properties === null) {
    schema.properties = {};
  }

  stripAdditionalProperties(schema);
  return schema;
}

function stripAdditionalProperties(schema: unknown): void {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (Array.isArray(schema)) {
    schema.forEach(stripAdditionalProperties);
    return;
  }

  const record = schema as Record<string, unknown>;

  if (record.additionalProperties !== undefined) {
    delete record.additionalProperties;
  }

  for (const value of Object.values(record)) {
    stripAdditionalProperties(value);
  }
}
