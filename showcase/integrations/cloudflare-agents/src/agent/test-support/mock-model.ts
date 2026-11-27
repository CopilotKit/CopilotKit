/**
 * Scripted AI SDK models for the Worker's unit tests. Each call to the model
 * returns the next scripted reply; the mock records every call's options.
 */
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type GenerateResult = Exclude<
  ConstructorParameters<typeof MockLanguageModelV4>[0],
  undefined
>["doGenerate"];

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** One scripted model reply: text, a tool call, or a failure. */
export type ScriptedReply =
  | { text: string }
  | { toolCall: { name: string; input: unknown; id?: string } }
  | { error: Error };

/** A model that answers its calls with `replies`, in order (the last repeats). */
export function scriptedModel(replies: ScriptedReply[]): MockLanguageModelV4 {
  let call = 0;
  const doGenerate: GenerateResult = async () => {
    const reply = replies[Math.min(call, replies.length - 1)]!;
    call += 1;
    if ("error" in reply) throw reply.error;
    if ("text" in reply) {
      return {
        content: [{ type: "text", text: reply.text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    }
    return {
      content: [
        {
          type: "tool-call",
          toolCallId: reply.toolCall.id ?? `call-${call}`,
          toolName: reply.toolCall.name,
          input: JSON.stringify(reply.toolCall.input),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: USAGE,
      warnings: [],
    };
  };
  return new MockLanguageModelV4({ doGenerate });
}

/** The system prompt a recorded call carried. */
export function systemPromptOf(model: MockLanguageModelV4, call = 0): string {
  const prompt = model.doGenerateCalls[call]?.prompt ?? [];
  return prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
}

/** The options the AI SDK hands a tool's `execute`, for calling it directly. */
export function toolOptions(
  toolCallId = "call-1",
  messages: ModelMessage[] = [],
) {
  return { toolCallId, messages, context: {} };
}
