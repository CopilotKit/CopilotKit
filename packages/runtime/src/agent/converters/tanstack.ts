import {
  BaseEvent,
  EventType,
  TextMessageChunkEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from "@ag-ui/client";
import { randomUUID } from "crypto";

/**
 * Converts a TanStack AI stream into AG-UI `BaseEvent` objects.
 *
 * This is a pure converter — it does NOT emit lifecycle events
 * (RUN_STARTED / RUN_FINISHED / RUN_ERROR). The caller (Agent class)
 * is responsible for those.
 */
export async function* convertTanStackStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = randomUUID();

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    const raw = chunk as Record<string, unknown>;
    const type = raw.type as string;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta) {
      const textEvent: TextMessageChunkEvent = {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
      yield textEvent;
    } else if (type === "TOOL_CALL_START") {
      const startEvent: ToolCallStartEvent = {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId: raw.toolCallId as string,
        toolCallName: raw.toolCallName as string,
      };
      yield startEvent;
    } else if (type === "TOOL_CALL_ARGS") {
      const argsEvent: ToolCallArgsEvent = {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: raw.toolCallId as string,
        delta: raw.delta as string,
      };
      yield argsEvent;
    } else if (type === "TOOL_CALL_END") {
      const endEvent: ToolCallEndEvent = {
        type: EventType.TOOL_CALL_END,
        toolCallId: raw.toolCallId as string,
      };
      yield endEvent;
    }
    // Unknown chunk types are silently ignored
  }
}
