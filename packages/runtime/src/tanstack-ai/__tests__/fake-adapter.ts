import { EventType as TanStackEventType } from "@tanstack/ai";
import type {
  AdapterYieldChunk,
  AnyTextAdapter,
  TextOptions,
} from "@tanstack/ai";

/** One model answer of the scripted adapter. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
}

/**
 * A minimal `@tanstack/ai` 1.x text adapter. `chatStream` answers each model
 * call with the next scripted turn, as AG-UI chunks, the way provider
 * adapters do. It records every request so tests can read what `chat()` sent
 * the model. Uses TanStack's own `EventType`: its `@ag-ui/core` version
 * differs from the runtime's.
 */
export function scriptedTextAdapter(
  turns: ScriptedTurn[],
  options: { name?: string; model?: string } = {},
) {
  const requests: TextOptions[] = [];
  const { name = "scripted", model = "scripted-model" } = options;

  async function* chatStream(
    request: TextOptions,
  ): AsyncIterable<AdapterYieldChunk> {
    requests.push(request);
    const turn = turns[requests.length - 1];
    if (!turn) throw new Error("The scripted adapter has no turn left");
    const runId = request.runId ?? "scripted-run";
    const { threadId } = request;
    const timestamp = Date.now();

    yield { type: TanStackEventType.RUN_STARTED, runId, threadId, timestamp };
    if (turn.text) {
      const messageId = `${runId}-text-${requests.length}`;
      yield {
        type: TanStackEventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        timestamp,
      };
      yield {
        type: TanStackEventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: turn.text,
        timestamp,
      };
      yield { type: TanStackEventType.TEXT_MESSAGE_END, messageId, timestamp };
    }
    const toolCalls = turn.toolCalls ?? [];
    for (const call of toolCalls) {
      yield {
        type: TanStackEventType.TOOL_CALL_START,
        toolCallId: call.id,
        toolCallName: call.name,
        timestamp,
      };
      yield {
        type: TanStackEventType.TOOL_CALL_ARGS,
        toolCallId: call.id,
        delta: JSON.stringify(call.input),
        timestamp,
      };
      yield {
        type: TanStackEventType.TOOL_CALL_END,
        toolCallId: call.id,
        timestamp,
      };
    }
    yield {
      type: TanStackEventType.RUN_FINISHED,
      runId,
      threadId,
      model,
      timestamp,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
    };
  }

  const adapter: AnyTextAdapter = {
    kind: "text",
    name,
    model,
    // Type-only slot of the adapter interface; chat() never reads it.
    "~types": {
      providerOptions: {},
      inputModalities: ["text"],
      messageMetadataByModality: {},
      toolCapabilities: [],
      toolCallMetadata: undefined,
      systemPromptMetadata: undefined,
    },
    chatStream,
    structuredOutput: async () => {
      throw new Error("The scripted adapter has no structured output");
    },
  };
  return { adapter, requests };
}

/** A turn that calls one tool. */
export function callTool(id: string, name: string, input: unknown) {
  const turn: ScriptedTurn = { toolCalls: [{ id, name, input }] };
  return turn;
}
