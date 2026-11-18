import type { Interrupt, RunAgentInput } from "@ag-ui/client";
import type { AnyServerTool, AnyTool } from "@tanstack/ai";
import { formatToolError } from "./converters/aisdk";
import { isRecord } from "./converters/usage";

const JSON_SCHEMA_TYPES = new Set([
  "object",
  "string",
  "number",
  "integer",
  "boolean",
  "array",
]);

/**
 * Whether a frontend tool's parameters are a JSON Schema: an empty object
 * (the tool takes no input), or an object whose `type` is a JSON Schema type
 * name.
 */
function isJsonSchema(value: unknown) {
  if (!isRecord(value)) return false;
  if (Object.keys(value).length === 0) return true;
  return typeof value.type === "string" && JSON_SCHEMA_TYPES.has(value.type);
}

/**
 * Checks that every frontend (AG-UI) tool's parameters are a JSON Schema, so
 * the classic agent fails the run before the model call instead of sending
 * an invalid schema to the provider.
 *
 * @param tools - The run input's frontend tools.
 * @throws Error `Invalid JSON schema for tool <name>` for the first tool whose
 *   parameters are not a JSON Schema.
 */
export function assertFrontendToolSchemas(tools: RunAgentInput["tools"]) {
  for (const tool of tools) {
    if (!isJsonSchema(tool.parameters)) {
      throw new Error(`Invalid JSON schema for tool ${tool.name}`);
    }
  }
}

/**
 * The tools that let the model change the application state. Their results
 * become STATE_SNAPSHOT and STATE_DELTA events in `convertTanStackStream`.
 */
export const STATE_TOOLS: readonly AnyServerTool[] = [
  {
    __toolSide: "server",
    name: "AGUISendStateSnapshot",
    description: "Replace the entire application state with a new snapshot",
    inputSchema: {
      type: "object",
      properties: {
        snapshot: { description: "The complete new state object" },
      },
      required: ["snapshot"],
      additionalProperties: false,
    },
    execute: ({ snapshot }: { snapshot?: unknown }) =>
      Promise.resolve({ success: true, snapshot }),
  },
  {
    __toolSide: "server",
    name: "AGUISendStateDelta",
    description:
      "Apply incremental updates to application state using JSON Patch operations",
    inputSchema: {
      type: "object",
      properties: {
        delta: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: ["add", "replace", "remove"],
                description: "The operation to perform",
              },
              path: {
                type: "string",
                description: "JSON Pointer path (e.g., '/foo/bar')",
              },
              value: {
                description:
                  "The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'.",
              },
            },
            required: ["op", "path"],
            additionalProperties: false,
          },
          description: "Array of JSON Patch operations",
        },
      },
      required: ["delta"],
      additionalProperties: false,
    },
    execute: ({
      delta,
    }: {
      delta: {
        op: "add" | "replace" | "remove";
        path: string;
        value?: unknown;
      }[];
    }) => Promise.resolve({ success: true, delta }),
  },
];

/**
 * The text of a TanStack AI tool error result. `chat()` sends a failed tool
 * call's result as `{"error": "<message>"}`.
 */
function toolErrorText(content: unknown) {
  if (typeof content !== "string") return formatToolError(content);
  try {
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed) && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON: the content is the error text.
  }
  return content;
}

function isToolErrorResult(chunk: Record<string, unknown>) {
  const metadata = isRecord(chunk.metadata) ? chunk.metadata : {};
  const tanstack = isRecord(metadata.tanstack) ? metadata.tanstack : {};
  return tanstack.state === "output-error";
}

/** The `Interrupt` fields that a call to an interrupt tool raises. */
type ToolInterrupt = { reason: string; message?: string };

/**
 * Reads the interrupt settings that `defineTool()` puts in
 * `metadata.copilotkit`. A tool without `interrupt: true` there has none.
 */
function toolInterrupt(tool: Pick<AnyTool, "metadata">) {
  const settings = tool.metadata?.copilotkit;
  if (!isRecord(settings) || settings.interrupt !== true) return undefined;
  const { interruptReason, interruptMessage } = settings;
  const interrupt: ToolInterrupt = {
    reason: typeof interruptReason === "string" ? interruptReason : "tool_call",
  };
  if (typeof interruptMessage === "string" && interruptMessage) {
    interrupt.message = interruptMessage;
  }
  return interrupt;
}

/**
 * Applies the classic tool rules to a TanStack AI `chat()` stream, before
 * `convertTanStackStream` turns it into AG-UI events.
 *
 * - A call to an interrupt tool (`interrupt: true` in the tool's
 *   `metadata.copilotkit`, as `defineTool()` sets it) adds one `Interrupt` to
 *   `pendingInterrupts` when the call ends, keyed by the tool call id. A
 *   result for that call is dropped: the human supplies it on the resume run.
 * - A failed tool call's result reads `Error: <message>`, for every tool
 *   (config, MCP, learned skills, and arguments that fail the schema).
 *
 * @param stream - The `chat()` stream.
 * @param tools - The classic config's tools.
 * @param pendingInterrupts - Filled with the interrupts of this run.
 */
export async function* withClassicToolRules(
  stream: AsyncIterable<unknown>,
  tools: readonly Pick<AnyTool, "name" | "metadata">[],
  pendingInterrupts: Interrupt[],
) {
  const interruptTools = new Map<string, ToolInterrupt>();
  for (const tool of tools) {
    const interrupt = toolInterrupt(tool);
    if (interrupt) interruptTools.set(tool.name, interrupt);
  }
  const interruptByCallId = new Map<string, ToolInterrupt>();
  const interruptedCallIds = new Set<string>();

  for await (const chunk of stream) {
    if (!isRecord(chunk) || typeof chunk.toolCallId !== "string") {
      yield chunk;
      continue;
    }
    const toolCallId = chunk.toolCallId;

    switch (chunk.type) {
      case "TOOL_CALL_START": {
        const interrupt =
          typeof chunk.toolCallName === "string"
            ? interruptTools.get(chunk.toolCallName)
            : undefined;
        if (interrupt) interruptByCallId.set(toolCallId, interrupt);
        break;
      }
      case "TOOL_CALL_END": {
        const interrupt = interruptByCallId.get(toolCallId);
        if (!interrupt || interruptedCallIds.has(toolCallId)) break;
        interruptedCallIds.add(toolCallId);
        pendingInterrupts.push({ id: toolCallId, toolCallId, ...interrupt });
        break;
      }
      case "TOOL_CALL_RESULT": {
        if (interruptByCallId.has(toolCallId)) continue;
        if (isToolErrorResult(chunk)) {
          yield { ...chunk, content: `Error: ${toolErrorText(chunk.content)}` };
          continue;
        }
        break;
      }
    }
    yield chunk;
  }
}
