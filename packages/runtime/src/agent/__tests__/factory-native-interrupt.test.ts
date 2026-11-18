/**
 * Integration tests for factory-mode native interrupts driven by the REAL
 * SDK loops (no network). They verify what synthetic-stream tests can't:
 *   1. a tool declared `needsApproval: true` makes the SDK emit its approval
 *      request (AI SDK `tool-approval-request`, TanStack `approval-requested`)
 *      and our converter turns it into outcome:interrupt;
 *   2. on resume, the tool result the runtime injects from the resume payload
 *      is accepted by the SDK, so the run continues (no re-approval loop).
 */
import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { jsonSchema, streamText, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import type { FakeResponseStep } from "@tanstack/ai/testing";
import { convertMessagesToVercelAISDKMessages } from "../ai-sdk";
import { convertInputToTanStackAI } from "../converters/tanstack";
import {
  BuiltInAgent,
  collectEvents,
  createDefaultInput,
  createFakeModel,
  eventsOfType,
} from "./agent-test-helpers";

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

const bookFlightSchema = {
  type: "object" as const,
  properties: { destination: { type: "string" as const } },
  required: ["destination"],
  additionalProperties: false,
};

function finishReason(unified: "stop" | "tool-calls") {
  return { unified, raw: unified };
}

function modelEmitting(chunks: StreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks }),
    }),
  });
}

function aisdkApprovalAgent(model: MockLanguageModelV3) {
  return new BuiltInAgent({
    type: "aisdk",
    factory: ({ input, abortSignal }) =>
      streamText({
        model,
        messages: convertMessagesToVercelAISDKMessages(input.messages),
        tools: {
          bookFlight: tool({
            description: "Book a flight. Requires approval.",
            inputSchema: jsonSchema<{ destination: string }>(bookFlightSchema),
            needsApproval: true,
          }),
        },
        abortSignal,
      }),
  });
}

function tanstackApprovalAgent(responses: FakeResponseStep[]) {
  const { model, requests } = createFakeModel(responses);
  const agent = new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages } = convertInputToTanStackAI(input);
      return chat({
        adapter: model,
        messages,
        tools: [
          toolDefinition({
            name: "bookFlight",
            description: "Book a flight. Requires approval.",
            inputSchema: bookFlightSchema,
            needsApproval: true,
          }).server(async () => "booked"),
        ],
        agentLoopStrategy: maxIterations(2),
        abortController,
        threadId: input.threadId,
        stream: true,
      });
    },
  });
  return { agent, requests };
}

const askToBook: Message = {
  id: "u1",
  role: "user",
  content: "Book a flight to Tokyo",
};

/** The input of a run that resumes an approved `bookFlight` call `tc-1`. */
function approvedResumeInput(): Partial<RunAgentInput> {
  return {
    resume: [
      {
        interruptId: "tc-1",
        status: "resolved",
        payload: { approved: true },
      },
    ],
    messages: [
      askToBook,
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
    ],
  };
}

function runFinished(events: BaseEvent[]) {
  const [finished] = eventsOfType(events, EventType.RUN_FINISHED);
  return finished;
}

function streamedText(events: BaseEvent[]) {
  return [
    ...eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK),
    ...eventsOfType(events, EventType.TEXT_MESSAGE_CONTENT),
  ]
    .map((event) => event.delta ?? "")
    .join("");
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
      agent.run(createDefaultInput({ messages: [askToBook] })),
    );

    expect(runFinished(events)).toMatchObject({
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "tc-1", toolCallId: "tc-1" }],
      },
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
      agent.run(createDefaultInput(approvedResumeInput())),
    );

    // Normal completion, no re-interrupt.
    expect(runFinished(events).outcome).toBeUndefined();
    expect(streamedText(events)).toBe("Booked your flight to Tokyo!");
  });
});

describe("factory tanstack native interrupt (real chat())", () => {
  // @tanstack/ai 1.2 chat() ends the turn with RUN_FINISHED
  // `outcome: { type: "interrupt" }` instead of a CUSTOM "approval-requested"
  // chunk.
  it("a needsApproval tool call → RUN_FINISHED outcome:interrupt", async () => {
    const { agent } = tanstackApprovalAgent([
      {
        toolCalls: [
          { id: "tc-1", name: "bookFlight", input: { destination: "Tokyo" } },
        ],
      },
    ]);

    const events = await collectEvents(
      agent.run(createDefaultInput({ messages: [askToBook] })),
    );

    expect(runFinished(events)).toMatchObject({
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "tc-1", toolCallId: "tc-1" }],
      },
    });
  });

  it("on resume, the injected tool-result is accepted and the run completes", async () => {
    const { agent, requests } = tanstackApprovalAgent([
      { text: "Booked your flight to Tokyo!" },
    ]);

    const events = await collectEvents(
      agent.run(createDefaultInput(approvedResumeInput())),
    );

    expect(runFinished(events).outcome).toBeUndefined();
    expect(streamedText(events)).toBe("Booked your flight to Tokyo!");
    expect(requests[0].messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "tc-1",
      content: JSON.stringify({ approved: true }),
    });
  });
});
