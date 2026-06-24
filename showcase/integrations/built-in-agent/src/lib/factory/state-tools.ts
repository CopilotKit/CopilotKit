import { z } from "zod";
import { toolDefinition } from "@tanstack/ai";

/**
 * Why these tools take JSON *strings* instead of typed objects (OSS-132).
 *
 * The arbitrary state payloads (snapshot / delta / steps) must cross
 * OpenAI's Responses API with `strict: true`. A `z.any()` (or
 * `z.array(z.any())`) field serializes to a *typeless* property —
 * `{ "description": ... }` with no `"type"` key. `@tanstack/openai-base`'s
 * `isStrictModeCompatible` only screens for `oneOf/allOf/not/$ref/$defs`,
 * so it misses the missing `type`, sends the tool with `strict: true`, and
 * the real Responses API rejects it on every prompt:
 *
 *   400 Invalid schema for function 'AGUISendStateSnapshot':
 *   In context=('properties','snapshot'), schema must have a 'type' key.
 *
 * This is the real-OpenAI form of OSS-132. It was masked because the
 * deployed showcase runs against aimock, which replays fixtures without
 * validating the request schema.
 *
 * Fix: declare each arbitrary payload as a JSON-encoded string
 * (`z.string()` → `{ "type": "string" }`, which IS strict-valid) and parse
 * it in the server handler. `parseJson` also tolerates an already-parsed
 * object/array, so recorded aimock fixtures that emit object-shaped tool
 * args keep working. The TanStack→AG-UI converter (`tanstack-factory.ts`)
 * reads the parsed structure off the tool *result*, so it needs no change.
 */
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const stateSnapshotTool = toolDefinition({
  name: "AGUISendStateSnapshot",
  description:
    "Replace the entire application state with a new snapshot. Pass `snapshot` as a JSON-encoded string of the complete new state object.",
  inputSchema: z.object({
    snapshot: z
      .string()
      .describe("JSON-encoded string of the complete new state object"),
  }),
}).server(async ({ snapshot }) => ({
  success: true,
  snapshot: parseJson(snapshot),
}));

export const stateDeltaTool = toolDefinition({
  name: "AGUISendStateDelta",
  description:
    "Apply incremental updates to application state using JSON Patch operations. Pass `delta` as a JSON-encoded string of an array of operations, each { op: 'add' | 'replace' | 'remove', path, value }.",
  inputSchema: z.object({
    delta: z
      .string()
      .describe(
        "JSON-encoded string of an array of JSON Patch operations, each { op: 'add' | 'replace' | 'remove', path, value }",
      ),
  }),
}).server(async ({ delta }) => ({ success: true, delta: parseJson(delta) }));

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
 * `[{op: "add", path: "/steps", value: <steps>}]`, mirroring what
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
    "Set the agent's plan as a list of steps. Pass `steps` as a JSON-encoded string of an ordered array; each step is an object the frontend reads at least { title, status }.",
  inputSchema: z.object({
    steps: z
      .string()
      .describe(
        "JSON-encoded string of an ordered array of plan-step objects, each at least { title, status }",
      ),
  }),
}).server(async ({ steps }) => ({ success: true, steps: parseJson(steps) }));

export const stateTools = [
  stateSnapshotTool,
  stateDeltaTool,
  setStepsTool,
] as const;
