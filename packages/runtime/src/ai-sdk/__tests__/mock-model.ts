/**
 * Shared helpers for driving `aiSdkAgent` with a mock AI SDK model: the real
 * `streamText` runs over a `MockLanguageModelV3` that streams fixed parts.
 */
import type { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { BuiltInAgent } from "../../agent";
import {
  collectEvents,
  createDefaultInput,
} from "../../agent/__tests__/agent-test-helpers";

/** One part of the stream a mock model returns from `doStream`. */
export type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

// The part builders below annotate their return type: the inferred one names
// `@ai-sdk/provider`, which this package does not depend on (TS2742).

export function finishPart(
  unified: "stop" | "tool-calls" = "stop",
): StreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: USAGE,
  };
}

/** The parts of one streamed text block, without a finish part. */
export function textParts(text: string, id = "t1"): StreamPart[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: text },
    { type: "text-end", id },
  ];
}

/** The parts of one streamed reasoning block, without a finish part. */
export function reasoningParts(text: string, id = "r1"): StreamPart[] {
  return [
    { type: "reasoning-start", id },
    { type: "reasoning-delta", id, delta: text },
    { type: "reasoning-end", id },
  ];
}

/** A complete model turn that answers with `text`. */
export function textTurn(text: string, id = "t1"): StreamPart[] {
  return [...textParts(text, id), finishPart("stop")];
}

/** A tool-call part, as a provider sends it after the input is complete. */
export function toolCallPart(
  toolCallId: string,
  toolName: string,
  input: unknown,
): StreamPart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  };
}

/** A complete model turn that calls one tool. */
export function toolCallTurn(
  toolCallId: string,
  toolName: string,
  input: unknown,
): StreamPart[] {
  return [toolCallPart(toolCallId, toolName, input), finishPart("tool-calls")];
}

/**
 * A model that streams `turns[n]` on its nth call, and the last turn on any
 * later call.
 */
export function modelEmittingTurns(turns: StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      const chunks = turns[Math.min(call, turns.length - 1)];
      call += 1;
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

/** A model that streams `turn` on every call. */
export function modelEmitting(turn: StreamPart[]) {
  return modelEmittingTurns([turn]);
}

/** Runs the agent once with a single user message and collects its events. */
export async function runAgent(
  agent: BuiltInAgent,
  input: Partial<RunAgentInput> = {},
) {
  return collectEvents(
    agent.run(
      createDefaultInput({
        messages: [{ id: "u1", role: "user", content: "hi" }],
        ...input,
      }),
    ),
  );
}

export function eventsOfType(events: BaseEvent[], type: EventType) {
  return events.filter((event) => event.type === type);
}

/** The names of the tools the model was offered on its first call. */
export function offeredToolNames(model: MockLanguageModelV3) {
  return (model.doStreamCalls[0].tools ?? []).map((tool) => tool.name);
}
