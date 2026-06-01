import { z } from "zod";
import { toolDefinition } from "@tanstack/ai";

export const stateSnapshotTool = toolDefinition({
  name: "AGUISendStateSnapshot",
  description: "Replace the entire application state with a new snapshot",
  inputSchema: z.object({
    snapshot: z.any().describe("The complete new state object"),
  }),
}).server(async ({ snapshot }) => ({ success: true, snapshot }));

export const stateDeltaTool = toolDefinition({
  name: "AGUISendStateDelta",
  description:
    "Apply incremental updates to application state using JSON Patch operations",
  inputSchema: z.object({
    delta: z
      .array(
        z.object({
          op: z.enum(["add", "replace", "remove"]),
          path: z.string(),
          value: z.any().optional(),
        }),
      )
      .describe("Array of JSON Patch operations"),
  }),
}).server(async ({ delta }) => ({ success: true, delta }));

export const stateTools = [stateSnapshotTool, stateDeltaTool] as const;
