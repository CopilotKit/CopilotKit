import { z } from "zod4";

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const jsonPrimitiveObjectSchema = z.object({}).catchall(jsonPrimitiveSchema);

/**
 * OpenAI's function-schema validator rejects the empty schemas produced by
 * z.any() and also rejects recursive z.lazy() output. This non-recursive
 * shape covers the state payloads used by the showcase demos while keeping
 * every generated property schema explicit.
 */
export const openAiJsonValueSchema = z.union([
  jsonPrimitiveSchema,
  jsonPrimitiveObjectSchema,
  z.array(z.union([jsonPrimitiveSchema, jsonPrimitiveObjectSchema])),
]);

export const openAiJsonObjectSchema = z
  .object({})
  .catchall(openAiJsonValueSchema);

export const openAiJsonArrayOfObjectsSchema = z.array(
  jsonPrimitiveObjectSchema,
);
