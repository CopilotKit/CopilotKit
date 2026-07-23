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

/**
 * `set_steps` — gen-ui-agent state tool.
 *
 * The gen-ui-agent demo (and its D5/D6 fixtures, shared across every
 * integration) is structured around a custom `set_steps(steps=[...])`
 * tool call. Other backends (LangGraph Python, Mastra, ...) define
 * `set_steps` as part of the agent's own state schema and stream the
 * resulting `steps` array as an AG-UI `STATE_DELTA` after each call.
 *
 * The built-in-agent runtime has no per-agent state schema, so we
 * expose `set_steps` as a generic server tool. The result is detected
 * downstream in the TanStack→AG-UI converter (`tanstack-factory.ts`)
 * and translated into a `STATE_DELTA` with
 * `[{op: "replace", path: "/steps", value: <steps>}]`, mirroring what
 * the demo's frontend (`useAgent` + `StepsPanel`) expects.
 *
 * Without this tool, the gen-ui-agent fixtures' `set_steps` tool calls
 * pass through as untyped TOOL_CALL events, no STATE_DELTA is ever
 * emitted, and the frontend's `agent.state.steps` never populates —
 * which leaves `<StepsPanel>` in its placeholder state and the D6
 * `agent-state-card` testid never mounts.
 */
export const setStepsTool = toolDefinition({
  name: "set_steps",
  description:
    "Set the agent's plan as a list of steps. Each step is an object with optional id, title, and status fields.",
  inputSchema: z.object({
    steps: z
      .array(z.any())
      .describe(
        "Ordered list of plan steps. Each step is an object; the frontend reads at least { title, status }.",
      ),
  }),
}).server(async ({ steps }) => ({ success: true, steps }));

export const stateTools = [
  stateSnapshotTool,
  stateDeltaTool,
  setStepsTool,
] as const;
