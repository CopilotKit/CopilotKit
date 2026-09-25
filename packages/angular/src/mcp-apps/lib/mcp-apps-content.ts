import { z } from "zod";
import { MCPAppsActivityContentSchema } from "@copilotkit/mcp-apps-renderer/activity";

/** Preserve the Angular export while sharing the runtime content contract. */
export const mcpAppsSnapshotContentSchema = MCPAppsActivityContentSchema;
export type MCPAppsSnapshotContent = z.output<
  typeof mcpAppsSnapshotContentSchema
>;
