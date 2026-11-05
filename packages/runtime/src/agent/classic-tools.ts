import type { Interrupt } from "@ag-ui/client";
import { schemaToJsonSchema } from "@copilotkit/shared";
import type { AnyServerTool } from "@tanstack/ai";
import { formatToolError } from "./converters/aisdk";
import { isRecord } from "./converters/usage";
import type { ToolDefinition } from "./index";

/**
 * Turns a `ToolDefinition` into a TanStack AI tool for `chat()`.
 *
 * The parameters become the JSON Schema that the model sees and that
 * `chat()` checks the arguments against. Before `execute` runs, the arguments
 * also go through the schema's own Standard Schema validation, so `execute`
 * gets the parsed output (for example with Zod defaults applied). An error
 * that `execute` throws becomes the tool's error result, with the same text
 * as before.
 *
 * A tool without `execute` (an interrupt tool) has no executor, so `chat()`
 * stops the run when the model calls it.
 */
function toTanStackTool(tool: ToolDefinition) {
  const serverTool: AnyServerTool = {
    __toolSide: "server",
    name: tool.name,
    description: tool.description,
    inputSchema: schemaToJsonSchema(tool.parameters),
  };
  const { execute } = tool;
  if (!execute) return serverTool;

  const validate = tool.parameters["~standard"].validate;
  const executeWithParsedArgs = async (args: unknown) => {
    const parsed = await validate(args);
    if (!("value" in parsed) || parsed.issues) {
      const issues = parsed.issues ?? [];
      const details = issues.map((issue) => issue.message).join("; ");
      throw new Error(`Invalid arguments for tool ${tool.name}: ${details}`);
    }
    try {
      return await execute(parsed.value);
    } catch (error) {
      throw new Error(formatToolError(error));
    }
  };
  return { ...serverTool, execute: executeWithParsedArgs };
}

/**
 * Turns the classic config's `tools` into TanStack AI tools, in the same
 * order.
 */
export function toTanStackTools(tools: readonly ToolDefinition[]) {
  return tools.map(toTanStackTool);
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
    execute: async ({ snapshot }: { snapshot?: unknown }) => ({
      success: true,
      snapshot,
    }),
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
    execute: async ({
      delta,
    }: {
      delta: {
        op: "add" | "replace" | "remove";
        path: string;
        value?: unknown;
      }[];
    }) => ({ success: true, delta }),
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

/**
 * Applies the classic tool rules to a TanStack AI `chat()` stream, before
 * `convertTanStackStream` turns it into AG-UI events.
 *
 * - A call to an interrupt tool (`interrupt: true`) adds one `Interrupt` to
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
  tools: readonly ToolDefinition[],
  pendingInterrupts: Interrupt[],
) {
  const interruptTools = new Map(
    tools.filter((tool) => tool.interrupt).map((tool) => [tool.name, tool]),
  );
  const interruptToolByCallId = new Map<string, ToolDefinition>();
  const interruptedCallIds = new Set<string>();

  for await (const chunk of stream) {
    if (!isRecord(chunk) || typeof chunk.toolCallId !== "string") {
      yield chunk;
      continue;
    }
    const toolCallId = chunk.toolCallId;

    switch (chunk.type) {
      case "TOOL_CALL_START": {
        const tool =
          typeof chunk.toolCallName === "string"
            ? interruptTools.get(chunk.toolCallName)
            : undefined;
        if (tool) interruptToolByCallId.set(toolCallId, tool);
        break;
      }
      case "TOOL_CALL_END": {
        const tool = interruptToolByCallId.get(toolCallId);
        if (!tool || interruptedCallIds.has(toolCallId)) break;
        interruptedCallIds.add(toolCallId);
        pendingInterrupts.push({
          id: toolCallId,
          toolCallId,
          reason: tool.interruptReason ?? "tool_call",
          ...(tool.interruptMessage ? { message: tool.interruptMessage } : {}),
        });
        break;
      }
      case "TOOL_CALL_RESULT": {
        if (interruptToolByCallId.has(toolCallId)) continue;
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
