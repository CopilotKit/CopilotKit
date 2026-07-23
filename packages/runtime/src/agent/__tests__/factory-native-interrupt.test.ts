/**
 * Integration tests for factory-mode native interrupts driven by the REAL
 * AI SDK `streamText` (via a mock LanguageModelV3 — no network). These verify
 * the two things synthetic-stream tests can't:
 *   1. a tool declared `needsApproval: true` actually makes `streamText` emit a
 *      `tool-approval-request` part → our converter turns it into outcome:interrupt;
 *   2. on resume, the tool-result the runtime injects from the resume payload is
 *      accepted by `streamText` so the run continues (no re-approval loop).
 */
import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText, tool } from "ai";
import type { FlexibleSchema } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { BuiltInAgent, convertMessagesToVercelAISDKMessages } from "../index";
import { collectEvents, createDefaultInput } from "./agent-test-helpers";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

type BookFlightInput = { destination: string };

const bookFlightInputSchema = z.object({
  destination: z.string(),
}) as unknown as FlexibleSchema<BookFlightInput>;

function finishReason(unified: "stop" | "tool-calls") {
  return { unified, raw: unified };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function modelEmitting(chunks: any[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks }),
    }),
  });
}

function aisdkApprovalAgent(model: MockLanguageModelV3): BuiltInAgent {
  return new BuiltInAgent({
    type: "aisdk",
    factory: ({ input, abortSignal }) =>
      streamText({
        model,
        messages: convertMessagesToVercelAISDKMessages(input.messages),
        tools: {
          bookFlight: tool<BookFlightInput, never>({
            description: "Book a flight. Requires approval.",
            inputSchema: bookFlightInputSchema,
            needsApproval: true,
          }),
        },
        abortSignal,
      }),
  });
}

describe("factory aisdk native interrupt (real streamText)", () => {
  it("a needsApproval tool call → RUN_FINISHED outcome:interrupt", async () => {
    const model = modelEmitting([
      {
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "bookFlight",
        input: JSON.stringify({ destination: "Tokyo" }),
      },
      {
        type: "finish",
        finishReason: finishReason("tool-calls"),
        usage: USAGE,
      },
    ]);
    const agent = aisdkApprovalAgent(model);

    const events = await collectEvents(
      agent.run(
        createDefaultInput({
          messages: [
            { id: "u1", role: "user", content: "Book a flight to Tokyo" },
          ] as RunAgentInput["messages"],
        }),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
    expect(finished.outcome?.type).toBe("interrupt");
    expect(finished.outcome.interrupts[0]).toMatchObject({
      id: "tc-1",
      toolCallId: "tc-1",
    });
  });

  it("on resume, the injected tool-result is accepted and the run completes", async () => {
    // Resume run: model now just replies (the tool call is already answered by
    // the injected result, so streamText must NOT re-request approval).
    const model = modelEmitting([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Booked your flight to Tokyo!" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: finishReason("stop"), usage: USAGE },
    ]);
    const agent = aisdkApprovalAgent(model);

    const events = await collectEvents(
      agent.run(
        createDefaultInput({
          resume: [
            {
              interruptId: "tc-1",
              status: "resolved",
              payload: { approved: true },
            },
          ],
          messages: [
            { id: "u1", role: "user", content: "Book a flight to Tokyo" },
            {
              id: "a1",
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "tc-1",
                  type: "function",
                  function: {
                    name: "bookFlight",
                    arguments: JSON.stringify({ destination: "Tokyo" }),
                  },
                },
              ],
            },
          ] as RunAgentInput["messages"],
        }),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
    // Normal completion — no re-interrupt.
    expect(finished.outcome).toBeUndefined();

    const text = events
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CHUNK)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e) => (e as any).delta)
      .join("");
    expect(text).toContain("Booked your flight");
  });
});
