import { z } from "zod";

/**
 * Zod schema for MCP Apps activity content (middleware 0.0.2 format). The
 * framework activity registries validate the activity content with this before
 * handing it to the renderer/session.
 */
export const MCPAppsActivityContentSchema = z.object({
  result: z.object({
    content: z.array(z.any()).optional(),
    structuredContent: z.any().optional(),
    isError: z.boolean().optional(),
  }),
  // Resource URI to fetch (e.g., "ui://server/dashboard")
  resourceUri: z.string(),
  // MD5 hash of server config (renamed from serverId in 0.0.1)
  serverHash: z.string(),
  // Optional stable server ID from config (takes precedence over serverHash)
  serverId: z.string().optional(),
  // Original tool input arguments
  toolInput: z.record(z.string(), z.unknown()).optional(),
});

export type MCPAppsActivityContent = z.infer<
  typeof MCPAppsActivityContentSchema
>;
