import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

/**
 * Content schema for `activityType: "mcp-apps"` activity messages: a snapshot
 * of an MCP Apps tool call, carrying the server id, the ui:// resource to
 * render, the tool result, and the tool input the app receives.
 *
 * Declared with the `zod/v4` API because the MCP SDK's `CallToolResultSchema`
 * is a zod/v4 schema and must not be nested inside a classic zod v3 object.
 */
export const mcpAppsSnapshotContentSchema = z.looseObject({
  serverId: z.string(),
  resourceUri: z.string(),
  result: CallToolResultSchema,
  toolInput: z.record(z.string(), z.unknown()),
});

/** Parsed content of an `mcp-apps` activity message. */
export type MCPAppsSnapshotContent = z.infer<
  typeof mcpAppsSnapshotContentSchema
>;
