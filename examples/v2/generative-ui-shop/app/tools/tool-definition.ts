import { toolDefinition as tanstackToolDefinition } from "@tanstack/ai";
import { withJsonSchema } from "#app/schemas/json-schema.ts";

/** `toolDefinition` of TanStack AI, for zod 3 schemas. */
export const toolDefinition: typeof tanstackToolDefinition = (config) => {
  withJsonSchema(config.inputSchema);
  withJsonSchema(config.outputSchema);
  return tanstackToolDefinition(config);
};
