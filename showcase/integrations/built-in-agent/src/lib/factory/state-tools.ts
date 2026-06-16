import { z } from "zod4";
import { toolDefinition } from "@tanstack/ai";
import {
  openAiJsonObjectSchema,
  openAiJsonValueSchema,
} from "./openai-json-schema";

export const stateSnapshotTool = toolDefinition({
  name: "AGUISendStateSnapshot",
  description: "Replace the entire application state with a new snapshot",
  inputSchema: z.object({
    snapshot: openAiJsonObjectSchema.describe("The complete new state object"),
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
          value: openAiJsonValueSchema.optional(),
        }),
      )
      .describe("Array of JSON Patch operations"),
  }),
}).server(async ({ delta }) => ({ success: true, delta }));

/**
 * `set_steps` — gen-ui-agent state tool.
 *
 * The gen-ui-agent demo is structured around a custom
 * `set_steps(steps=[...])` tool call. The Built-in Agent exposes that
 * operation as a normal server tool, then turns the returned `steps` array
 * into an AG-UI state update for the frontend.
 *
 * The result is detected downstream in the TanStack→AG-UI converter
 * (`tanstack-factory.ts`) and translated into a `STATE_SNAPSHOT` with
 * `{ steps }`, matching what the demo's frontend (`useAgent` +
 * `StepsPanel`) expects.
 *
 * Without this tool, `set_steps` calls would pass through as plain tool
 * events, no state snapshot would be emitted, and the frontend's
 * `agent.state.steps` would never populate.
 */
export const setStepsTool = toolDefinition({
  name: "set_steps",
  description:
    "Set the agent's plan as a list of steps. Each step must include id, title, and status.",
  inputSchema: z.object({
    steps: z
      .array(
        z.object({
          id: z.string().describe("Stable unique step id."),
          title: z.string().describe("Short user-facing step title."),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      )
      .describe("Ordered list of exactly 3 plan steps with current statuses."),
  }),
}).server(async ({ steps }) => ({ success: true, steps }));

export const stateTools = [
  stateSnapshotTool,
  stateDeltaTool,
  setStepsTool,
] as const;
