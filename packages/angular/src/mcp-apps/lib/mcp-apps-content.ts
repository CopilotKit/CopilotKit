import { z } from "zod/v4";

const annotationsSchema = z.looseObject({
  audience: z.array(z.enum(["user", "assistant"])).optional(),
  priority: z.number().min(0).max(1).optional(),
  lastModified: z.string().optional(),
});

const base64Schema = z
  .string()
  .refine(
    (value) =>
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
      !/=/.test(value.slice(0, -2)),
    "Expected base64-encoded data",
  );

const resourceContentsSchema = z.union([
  z.looseObject({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string(),
  }),
  z.looseObject({
    uri: z.string(),
    mimeType: z.string().optional(),
    blob: base64Schema,
  }),
]);

const contentItemSchema = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("text"),
    text: z.string(),
    annotations: annotationsSchema.optional(),
  }),
  z.looseObject({
    type: z.literal("image"),
    data: base64Schema,
    mimeType: z.string(),
    annotations: annotationsSchema.optional(),
  }),
  z.looseObject({
    type: z.literal("audio"),
    data: base64Schema,
    mimeType: z.string(),
    annotations: annotationsSchema.optional(),
  }),
  z.looseObject({
    type: z.literal("resource"),
    resource: resourceContentsSchema,
    annotations: annotationsSchema.optional(),
  }),
  z.looseObject({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    annotations: annotationsSchema.optional(),
  }),
]);

const callToolResultSchema = z.looseObject({
  content: z.array(contentItemSchema).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Content schema for `activityType: "mcp-apps"` activity messages: a snapshot
 * of an MCP Apps tool call, carrying the middleware server hash, optional
 * stable server id, the ui:// resource to render, and its tool exchange.
 *
 * Kept local and declared with the `zod/v4` API so the Angular browser bundle
 * validates protocol data without taking a direct MCP client SDK dependency.
 */
export const mcpAppsSnapshotContentSchema = z.looseObject({
  serverHash: z.string(),
  serverId: z.string().optional(),
  resourceUri: z.string(),
  result: callToolResultSchema,
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

/** Parsed content of an `mcp-apps` activity message. */
export type MCPAppsSnapshotContent = z.infer<
  typeof mcpAppsSnapshotContentSchema
>;
