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

// @region[gen-ui-agent-state]
/**
 * `set_steps` — gen-ui-agent state tool.
 *
 * The gen-ui-agent demo (and its D5/D6 fixtures, shared across every
 * integration) is structured around a custom `set_steps(steps=[...])`
 * tool call. Other backends (LangGraph Python, Mastra, ...) declare
 * `steps` in the agent's own state schema and publish it after each
 * `set_steps` call.
 *
 * The built-in-agent runtime has no per-agent state schema, so we
 * expose `set_steps` as a generic server tool whose result carries the
 * step list. The TanStack→AG-UI converter (`tanstack-factory.ts`)
 * detects that result and emits a `STATE_DELTA` with
 * `[{op: "add", path: "/steps", value: <steps>}]`, which is what the
 * demo's frontend (`useAgent` + `InlineAgentStateCard`) reads as
 * `agent.state.steps`.
 *
 * Without this tool, the gen-ui-agent fixtures' `set_steps` tool calls
 * pass through as untyped TOOL_CALL events, no STATE_DELTA is ever
 * emitted, and the frontend's `agent.state.steps` never populates —
 * so the `agent-state-card` testid never mounts.
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
// @endregion[gen-ui-agent-state]
