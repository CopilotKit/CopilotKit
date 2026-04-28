import * as vscode from "vscode";
import type { RunAgentInput } from "@ag-ui/client";

/**
 * BuiltInAgent (TanStack factory mode) consumes async iterables of these chunks.
 * Mirrors the chunk vocabulary `convertTanStackStream` understands in
 * `packages/runtime/src/agent/converters/tanstack.ts`.
 */
export type TanStackChunk =
  | { type: "TEXT_MESSAGE_CONTENT"; delta: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string };

export interface AgentFactoryContext {
  input: RunAgentInput;
  abortController: AbortController;
  abortSignal: AbortSignal;
}

export interface VscodeLmFactoryOptions {
  model: vscode.LanguageModelChat;
  mode: "live"; // record + replay added in Task 4
}

export function vscodeLmFactory(
  opts: VscodeLmFactoryOptions,
): (ctx: AgentFactoryContext) => AsyncIterable<TanStackChunk> {
  return async function* (ctx) {
    const messages = toLmMessages(ctx.input);
    const tokenSource = new vscode.CancellationTokenSource();
    ctx.abortSignal.addEventListener("abort", () => tokenSource.cancel(), {
      once: true,
    });

    try {
      const response = await opts.model.sendRequest(
        messages,
        {},
        tokenSource.token,
      );
      for await (const part of response.stream) {
        if (ctx.abortSignal.aborted) break;
        yield* translatePart(part);
      }
    } finally {
      tokenSource.dispose();
    }
  };
}

function toLmMessages(input: RunAgentInput): vscode.LanguageModelChatMessage[] {
  const out: vscode.LanguageModelChatMessage[] = [];
  for (const m of input.messages) {
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") {
      out.push(vscode.LanguageModelChatMessage.User(text));
    } else if (m.role === "assistant") {
      out.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
    // Other roles (system / developer / tool / reasoning / activity) are skipped
    // for now — the runtime's input converter places system/developer content in
    // systemPrompts which we'll thread through here in a follow-up.
  }
  return out;
}

function* translatePart(part: unknown): Generator<TanStackChunk> {
  if (part instanceof vscode.LanguageModelTextPart) {
    yield { type: "TEXT_MESSAGE_CONTENT", delta: part.value };
    return;
  }
  if (part instanceof vscode.LanguageModelToolCallPart) {
    const toolCallId = part.callId;
    yield {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: part.name,
    };
    yield {
      type: "TOOL_CALL_ARGS",
      toolCallId,
      delta: JSON.stringify(part.input ?? {}),
    };
    yield { type: "TOOL_CALL_END", toolCallId };
    return;
  }
  // Unhandled part types are silently dropped — same posture as
  // convertTanStackStream's "unhandled chunks ignored" comment.
}
