import { z } from "zod";

// Keep /activity bridge-free: the MCP SDK is only used as a test oracle.
// This is the Angular host's content contract, expressed using our zod API.
const looseObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).passthrough();

const annotationsSchema = looseObject({
  audience: z.array(z.enum(["user", "assistant"])).optional(),
  priority: z.number().min(0).max(1).optional(),
  lastModified: z.string().optional(),
});

// Validated by decoding, mirroring the MCP SDK's own base64 check, rather than
// by pattern. The pattern this replaces additionally required canonical padding,
// which the SDK does not: it accepts an unpadded payload that we rejected. Since
// one bad block fails the whole content array, that cost the entire widget.
const base64Schema = z.string().refine((value) => {
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}, "Expected base64-encoded data");

const resourceContentsSchema = z.union([
  looseObject({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string(),
  }),
  looseObject({
    uri: z.string(),
    mimeType: z.string().optional(),
    blob: base64Schema,
  }),
]);

const contentItemSchema = z.discriminatedUnion("type", [
  looseObject({
    type: z.literal("text"),
    text: z.string(),
    annotations: annotationsSchema.optional(),
  }),
  looseObject({
    type: z.literal("image"),
    data: base64Schema,
    mimeType: z.string(),
    annotations: annotationsSchema.optional(),
  }),
  looseObject({
    type: z.literal("audio"),
    data: base64Schema,
    mimeType: z.string(),
    annotations: annotationsSchema.optional(),
  }),
  looseObject({
    type: z.literal("resource"),
    resource: resourceContentsSchema,
    annotations: annotationsSchema.optional(),
  }),
  looseObject({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    annotations: annotationsSchema.optional(),
  }),
]);

const callToolResultSchema = looseObject({
  content: z.array(contentItemSchema).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

/** Activity input accepts an omitted result.content; validation defaults it to []. */
export const MCPAppsActivityContentSchema = looseObject({
  result: callToolResultSchema,
  resourceUri: z.string(),
  serverHash: z.string(),
  serverId: z.string().optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

// Keep the public input contract compatible with structured-only results.
// Parsed output is normalized before it crosses the bridge.
export type MCPAppsActivityContent = z.input<
  typeof MCPAppsActivityContentSchema
>;
