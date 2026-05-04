import type { SavedFixture } from "./fixture-store";
import type { TanStackChunk } from "./vscode-lm-factory";

export interface ReplayMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}

interface RawAgUiMessage {
  id?: string;
  role?: string;
  content?: unknown;
  toolCalls?: unknown;
  toolCallId?: string;
}

/**
 * Reconstructs the playback conversation for a saved fixture.
 *
 * Each `RecordedCall` in the fixture captures one model invocation: the
 * input snapshot (the conversation up to that point) and the chunks the
 * model streamed back. The LAST call's `input.messages` contains every
 * user/assistant/tool message that came BEFORE the final assistant turn;
 * its `chunks` reconstruct that final turn (text + tool calls + any
 * server-side tool results).
 *
 * Returning a flat `ReplayMessage[]` lets the chat surface animate them in
 * one at a time as if the conversation were happening live, without us
 * needing to coordinate a real runtime round-trip per message (the
 * matchKey-based replay path is fragile across tool list changes; a pure
 * visual playback is robust and what the user actually wants here).
 */
export function buildReplayMessages(fixture: SavedFixture): ReplayMessage[] {
  if (!fixture.calls.length) return [];
  const last = fixture.calls[fixture.calls.length - 1];

  const out: ReplayMessage[] = [];
  const rawMessages = Array.isArray(last.input.messages)
    ? (last.input.messages as RawAgUiMessage[])
    : [];
  for (const m of rawMessages) {
    const norm = normalizeMessage(m);
    if (norm) out.push(norm);
  }

  const finalTurn = reconstructTurnFromChunks(last.chunks);
  out.push(...finalTurn);
  return out;
}

function normalizeMessage(m: RawAgUiMessage): ReplayMessage | null {
  if (m.role !== "user" && m.role !== "assistant" && m.role !== "tool") {
    return null;
  }
  const content = typeof m.content === "string" ? m.content : "";
  const toolCalls = Array.isArray(m.toolCalls)
    ? (m.toolCalls as ReplayMessage["toolCalls"])
    : undefined;
  return {
    id: m.id ?? randomId(),
    role: m.role,
    content,
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(typeof m.toolCallId === "string" ? { toolCallId: m.toolCallId } : {}),
  };
}

/**
 * Walks the chunk stream from a single `RecordedCall` and rebuilds the
 * messages it produced — one assistant message (with accumulated text +
 * tool calls) plus any TOOL_CALL_RESULT chunks emitted server-side
 * (vscode.lm tool invocations).
 */
function reconstructTurnFromChunks(chunks: TanStackChunk[]): ReplayMessage[] {
  let text = "";
  const toolCalls: NonNullable<ReplayMessage["toolCalls"]> = [];
  const toolResults: ReplayMessage[] = [];

  for (const chunk of chunks) {
    switch (chunk.type) {
      case "TEXT_MESSAGE_CHUNK":
      case "TEXT_MESSAGE_CONTENT": {
        if (typeof chunk.delta === "string") text += chunk.delta;
        break;
      }
      case "TOOL_CALL_START": {
        toolCalls.push({
          id: chunk.toolCallId,
          type: "function",
          function: { name: chunk.toolCallName, arguments: "" },
        });
        break;
      }
      case "TOOL_CALL_ARGS": {
        const tc = toolCalls.find((t) => t.id === chunk.toolCallId);
        if (tc && typeof chunk.delta === "string") {
          tc.function.arguments += chunk.delta;
        }
        break;
      }
      case "TOOL_CALL_RESULT": {
        toolResults.push({
          id: randomId(),
          role: "tool",
          toolCallId: chunk.toolCallId,
          content:
            typeof chunk.content === "string"
              ? chunk.content
              : JSON.stringify(chunk.content ?? null),
        });
        break;
      }
      // TOOL_CALL_END / RUN_ERROR have no content we need for replay.
      default:
        break;
    }
  }

  const out: ReplayMessage[] = [];
  if (text || toolCalls.length > 0) {
    out.push({
      id: randomId(),
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }
  out.push(...toolResults);
  return out;
}

function randomId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
