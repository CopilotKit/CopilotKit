/**
 * Agent-trace capture for in-app Threads. SERVER-ONLY.
 *
 * The runtime runs the Ledgerline agent once per turn. Each run's INPUT carries
 * the Thread's messages (the user's request, and the results of the frontend
 * tools the previous run called); its OUTPUT is the AG-UI event stream (the
 * assistant's text and its tool calls). `traceRun` reads both, so the store
 * gets every tool call with its args, result, status and duration, and every
 * user and assistant message, keyed by the Thread id.
 *
 * Duration is measured from the call's TOOL_CALL_END to the run that brings
 * its result back, which is the time the frontend tool took in the browser.
 */

import * as store from "./store";

interface InputMessage {
  id?: string;
  role?: string;
  content?: unknown;
  toolCallId?: string;
}

interface RunInput {
  threadId?: string;
  messages?: InputMessage[];
}

interface AgUiEvent {
  type?: string;
  messageId?: string;
  delta?: string;
  toolCallId?: string;
  toolCallName?: string;
  content?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text)
          : "",
      )
      .join(" ");
  }
  return "";
}

/** Called with each run's input, before the model runs. */
export function traceRunInput(input: RunInput, now = Date.now()): void {
  const threadId = input.threadId;
  if (!threadId || !Array.isArray(input.messages)) return;
  for (const m of input.messages) {
    if (m.role === "user" && m.id) {
      store.recordMessage(threadId, "in_app", {
        id: m.id,
        role: "user",
        text: textOf(m.content),
        at: now,
      });
    } else if (m.role === "tool" && m.toolCallId) {
      store.recordToolResult(
        m.toolCallId,
        typeof m.content === "string" ? m.content : textOf(m.content),
        now,
      );
    }
  }
}

/** A per-run accumulator for the output stream. */
export function traceRunOutput(threadId: string | undefined) {
  const texts = new Map<string, string>();
  const args = new Map<string, { name: string; buf: string }>();
  let reasoning = "";
  const flushTexts = (now: number) => {
    if (!threadId) return;
    for (const [messageId, text] of texts) {
      store.recordMessage(threadId, "in_app", {
        id: messageId,
        role: "assistant",
        text,
        at: now,
      });
    }
    texts.clear();
  };
  return (event: AgUiEvent, now = Date.now()) => {
    if (!threadId || !event?.type) return;
    switch (event.type) {
      // BuiltInAgent streams assistant text as CHUNK events; they are
      // assembled per message and recorded when the run ends.
      case "TEXT_MESSAGE_CHUNK":
        if (event.messageId)
          texts.set(
            event.messageId,
            (texts.get(event.messageId) ?? "") + (event.delta ?? ""),
          );
        break;
      case "RUN_FINISHED":
      case "RUN_ERROR":
        flushTexts(now);
        break;
      case "TEXT_MESSAGE_START":
        if (event.messageId) texts.set(event.messageId, "");
        break;
      case "TEXT_MESSAGE_CONTENT":
        if (event.messageId)
          texts.set(
            event.messageId,
            (texts.get(event.messageId) ?? "") + (event.delta ?? ""),
          );
        break;
      case "TEXT_MESSAGE_END":
        if (event.messageId) {
          store.recordMessage(threadId, "in_app", {
            id: event.messageId,
            role: "assistant",
            text: texts.get(event.messageId) ?? "",
            at: now,
          });
          texts.delete(event.messageId);
        }
        break;
      case "TOOL_CALL_START":
        if (event.toolCallId)
          args.set(event.toolCallId, {
            name: event.toolCallName ?? "tool",
            buf: "",
          });
        break;
      case "TOOL_CALL_ARGS": {
        const a = event.toolCallId ? args.get(event.toolCallId) : undefined;
        if (a) a.buf += event.delta ?? "";
        break;
      }
      case "TOOL_CALL_END": {
        const a = event.toolCallId ? args.get(event.toolCallId) : undefined;
        if (!a || !event.toolCallId) break;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = a.buf ? (JSON.parse(a.buf) as Record<string, unknown>) : {};
        } catch {
          parsed = { raw: a.buf };
        }
        if (reasoning.trim()) {
          store.recordThinking(threadId, reasoning, now);
          reasoning = "";
        }
        // Text streamed before a tool call (a short narration) is its own message.
        flushTexts(now);
        store.recordToolCall(threadId, "in_app", {
          toolCallId: event.toolCallId,
          name: a.name,
          args: parsed,
          at: now,
        });
        args.delete(event.toolCallId);
        break;
      }
      case "TOOL_CALL_RESULT":
        if (event.toolCallId)
          store.recordToolResult(event.toolCallId, event.content, now);
        break;
      default:
        // Reasoning streams (REASONING_* / THINKING_*) become "thinking" trace items.
        if (
          /REASONING|THINKING/.test(event.type) &&
          /CONTENT/.test(event.type) &&
          event.delta
        ) {
          reasoning += event.delta;
        }
    }
  };
}
