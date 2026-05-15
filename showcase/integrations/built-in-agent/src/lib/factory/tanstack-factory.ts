import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
import { stateTools } from "./state-tools";
import { baseServerTools } from "./server-tools";
import { buildSubagentTools } from "./subagent-tools";

/**
 * Convert a JSON Schema object to a Zod schema (shallow — handles the
 * common { type: "object", properties: {...} } shape that AG-UI tools
 * produce). Deep/recursive conversion is intentionally omitted: the
 * schema is only used for LLM tool-call declaration, not runtime
 * validation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.object({});
  if (schema.type === "object" && schema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {};
    const required = new Set<string>(schema.required ?? []);
    for (const [key, prop] of Object.entries(schema.properties)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = prop as any;
      let field: z.ZodTypeAny;
      switch (p?.type) {
        case "string":
          field = z.string();
          break;
        case "number":
        case "integer":
          field = z.number();
          break;
        case "boolean":
          field = z.boolean();
          break;
        case "array":
          field = z.array(z.any());
          break;
        default:
          field = z.any();
      }
      if (p?.description) field = field.describe(p.description);
      shape[key] = required.has(key) ? field : field.optional();
    }
    return z.object(shape);
  }
  return z.object({});
}

function randomUUID(): string {
  return crypto.randomUUID();
}

/**
 * Convert a TanStack AI stream to AG-UI events.
 *
 * Unlike the runtime's built-in `convertTanStackStream`, this converter
 * does NOT stop processing after the first RUN_FINISHED event. TanStack's
 * chat() engine runs a multi-turn agent loop: after the model returns tool
 * calls with finish_reason=tool_calls, TanStack emits RUN_FINISHED,
 * executes server-side tools, emits TOOL_CALL_RESULT, then re-prompts the
 * model for a text response. The built-in runtime converter blocks all
 * events after RUN_FINISHED (PR #4476), which breaks server-tool execution
 * and subsequent text responses.
 *
 * This converter deduplicates tool-call events by tracking which
 * toolCallIds have already emitted TOOL_CALL_START. TanStack's
 * buildToolResultChunks re-emits TOOL_CALL_START/ARGS/END for server tool
 * results — we suppress the duplicate START/ARGS but keep the END and
 * RESULT events.
 */
async function* convertStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = randomUUID();
  // Track tool calls that have already emitted TOOL_CALL_END to suppress
  // duplicate START/ARGS/END from TanStack's buildToolResultChunks.
  // TOOL_CALL_RESULT is always emitted (it only comes from buildToolResultChunks).
  const completedToolCalls = new Set<string>();
  // Map toolCallId → toolName for state-tool detection on TOOL_CALL_RESULT.
  const toolNamesById = new Map<string, string>();

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = chunk as any;
    const type = raw.type as string;

    // Skip RUN_FINISHED from TanStack's adapter — the Agent class emits
    // its own lifecycle events.
    if (type === "RUN_FINISHED") continue;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_START") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) {
        // Duplicate from buildToolResultChunks — skip.
        continue;
      }
      toolNamesById.set(toolCallId, raw.toolCallName as string);
      yield {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId,
        toolCallName: raw.toolCallName as string,
      };
    } else if (type === "TOOL_CALL_ARGS") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_END") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      completedToolCalls.add(toolCallId);
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId,
      };
    } else if (type === "TOOL_CALL_RESULT") {
      const toolCallId = raw.toolCallId as string;
      const toolName = toolNamesById.get(toolCallId);
      const rawPayload = raw.content ?? raw.result;
      const parsedContent =
        typeof rawPayload === "string" ? safeParseJSON(rawPayload) : rawPayload;

      // Detect state-snapshot tool results.
      if (
        toolName === "AGUISendStateSnapshot" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "snapshot" in parsedContent
      ) {
        yield {
          type: EventType.STATE_SNAPSHOT,
          snapshot: (parsedContent as { snapshot: unknown }).snapshot,
        };
      }
      if (
        toolName === "AGUISendStateDelta" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "delta" in parsedContent
      ) {
        yield {
          type: EventType.STATE_DELTA,
          delta: (parsedContent as { delta: unknown[] }).delta,
        };
      }

      let serializedContent: string;
      if (typeof rawPayload === "string") {
        serializedContent = rawPayload;
      } else {
        try {
          serializedContent = JSON.stringify(rawPayload ?? null);
        } catch {
          serializedContent = "[Unserializable tool result]";
        }
      }

      yield {
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        messageId: randomUUID(),
        toolCallId,
        content: serializedContent,
      };
    }
    // All other event types (CUSTOM, STEP_FINISHED, etc.) are silently
    // ignored — the runtime does not need them.
  }
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function createBuiltInAgent() {
  return new BuiltInAgent({
    // Use "custom" to bypass the runtime's convertTanStackStream which
    // has a runFinished flag (PR #4476) that blocks all events after the
    // first RUN_FINISHED. This breaks the multi-turn agent loop needed
    // for server-tool execution (tool-rendering, shared-state).
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      // Subagent tools are built per-run so their nested chat() calls
      // abort with the parent.
      const subagentTools = buildSubagentTools(abortController);

      const serverTools = [...stateTools, ...baseServerTools, ...subagentTools];

      // Collect server-side tool names so we can skip frontend tools
      // that shadow them (e.g. get_weather has both a server executor
      // and a useRenderTool on the frontend).
      const serverToolNames = new Set(serverTools.map((t) => t.name));

      // Convert AG-UI frontend tools (useHumanInTheLoop, useRenderTool,
      // useFrontendTool) to TanStack definition-only tool declarations.
      // TanStack's chat() treats these as "needs client execution" and
      // pauses the agent loop, allowing the CopilotKit frontend SDK to
      // handle them.
      const frontendTools = (input.tools ?? [])
        .filter((t) => !serverToolNames.has(t.name))
        .map((t) =>
          toolDefinition({
            name: t.name,
            description: t.description ?? "",
            inputSchema: jsonSchemaToZod(t.parameters),
          }),
        );

      const stream = chat({
        adapter: openaiText("gpt-4o"),
        messages,
        systemPrompts,
        tools: [...serverTools, ...frontendTools],
        abortController,
      });

      return convertStream(stream, abortController.signal);
    },
  });
}
