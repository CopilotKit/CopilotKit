import * as crypto from "node:crypto";
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

export interface RecordedCall {
  matchKey: string;
  /** Raw input snapshot — for human inspection of the fixture. Not used for matching. */
  input: { messages: unknown; tools: unknown; modelId: string };
  chunks: TanStackChunk[];
}

export type VscodeLmFactoryOptions =
  | {
      model: vscode.LanguageModelChat;
      mode: "live";
    }
  | {
      model: vscode.LanguageModelChat;
      mode: "record";
      onCallRecorded: (call: RecordedCall) => void;
    }
  | {
      model: vscode.LanguageModelChat;
      mode: "replay";
      /** The full set of recorded calls from the loaded fixture. */
      fixtureCalls: RecordedCall[];
    };

export function vscodeLmFactory(
  opts: VscodeLmFactoryOptions,
): (ctx: AgentFactoryContext) => AsyncIterable<TanStackChunk> {
  // Replay state: how many times each matchKey has been consumed in this session.
  const replayCursor = new Map<string, number>();
  const fixtureCalls = opts.mode === "replay" ? opts.fixtureCalls : [];

  return async function* (ctx) {
    const matchKey = computeMatchKey(ctx.input, opts.model.id);

    if (opts.mode === "replay") {
      const consumed = replayCursor.get(matchKey) ?? 0;
      let seen = 0;
      for (const call of fixtureCalls) {
        if (call.matchKey !== matchKey) continue;
        if (seen === consumed) {
          replayCursor.set(matchKey, consumed + 1);
          for (const c of call.chunks) yield c;
          return;
        }
        seen++;
      }
      throw new Error(
        `vscode-lm-factory: no fixture call matches matchKey=${matchKey} (consumed=${consumed})`,
      );
    }

    // Live + record both call vscode.lm.
    const messages = toLmMessages(ctx.input);
    const tokenSource = new vscode.CancellationTokenSource();
    ctx.abortSignal.addEventListener("abort", () => tokenSource.cancel(), {
      once: true,
    });

    const recordedChunks: TanStackChunk[] = [];

    const tools = toLmTools(ctx.input.tools);

    try {
      const response = await opts.model.sendRequest(
        messages,
        tools.length > 0 ? { tools } : {},
        tokenSource.token,
      );
      for await (const part of response.stream) {
        if (ctx.abortSignal.aborted) break;
        for (const chunk of translatePart(part)) {
          if (opts.mode === "record") recordedChunks.push(chunk);
          yield chunk;
        }
      }
    } finally {
      tokenSource.dispose();
    }

    if (opts.mode === "record") {
      opts.onCallRecorded({
        matchKey,
        input: {
          messages: ctx.input.messages,
          tools: ctx.input.tools,
          modelId: opts.model.id,
        },
        chunks: recordedChunks,
      });
    }
  };
}

function computeMatchKey(input: RunAgentInput, modelId: string): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        messages: input.messages,
        tools: input.tools,
        modelId,
      }),
    )
    .digest("hex");
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
  }
  return out;
}

/**
 * Translates AG-UI tools (`{ name, description, parameters }`) into vscode.lm's
 * `LanguageModelChatTool[]` shape. AG-UI's `parameters` is a JSON Schema object;
 * `LanguageModelChatTool.inputSchema` accepts the same shape, so it passes
 * through unchanged. Tools without a name are skipped (defensive).
 */
function toLmTools(
  agUiTools: RunAgentInput["tools"] | undefined,
): vscode.LanguageModelChatTool[] {
  if (!agUiTools || agUiTools.length === 0) return [];
  const out: vscode.LanguageModelChatTool[] = [];
  for (const t of agUiTools) {
    if (!t || typeof t !== "object" || typeof t.name !== "string") continue;
    out.push({
      name: t.name,
      description: typeof t.description === "string" ? t.description : t.name,
      inputSchema: t.parameters as object,
    });
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
    yield { type: "TOOL_CALL_START", toolCallId, toolCallName: part.name };
    yield {
      type: "TOOL_CALL_ARGS",
      toolCallId,
      delta: JSON.stringify(part.input ?? {}),
    };
    yield { type: "TOOL_CALL_END", toolCallId };
    return;
  }
}
