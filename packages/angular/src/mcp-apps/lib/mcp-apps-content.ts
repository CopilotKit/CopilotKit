import { z } from "zod";
import { MCPAppsActivityContentSchema } from "@copilotkit/shared";

/** Preserve the Angular export while sharing the runtime content contract. */
export const mcpAppsSnapshotContentSchema = MCPAppsActivityContentSchema;
export type MCPAppsSnapshotContent = z.output<
  typeof mcpAppsSnapshotContentSchema
>;
