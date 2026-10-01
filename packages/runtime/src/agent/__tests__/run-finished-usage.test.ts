import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BuiltInAgent } from "../index";
import { collectEvents, mockStreamTextResponse } from "./test-helpers";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function runAndCollectFinished(agent: BuiltInAgent) {
  const events = await collectEvents(agent.run(createInput()));
  const finished = events.filter(
    (event) => event.type === EventType.RUN_FINISHED,
  );
  expect(finished).toHaveLength(1);
  expect(finished[0]).not.toHaveProperty("finishReason");
  return finished[0];
}

function createInput(): RunAgentInput {
  return {
    threadId: "thread-token-usage",
    runId: "run-token-usage",
    messages: [{ id: "message-1", role: "user", content: "Hi" }],
    tools: [],
    context: [],
    state: {},
  };
}

const finishPart = {
  type: "finish",
  finishReason: "stop",
  totalUsage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  },
};

test("classic AI SDK runs include total token usage on RUN_FINISHED", async () => {
  const model = {
    specificationVersion: "v3" as const,
    modelId: "test-model",
    provider: "test-provider",
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  };
  const agent = new BuiltInAgent({ model });
  vi.mocked(streamText).mockReturnValue(mockStreamTextResponse([finishPart]));

  const finished = await runAndCollectFinished(agent);

  expect(finished).toMatchObject({
    type: EventType.RUN_FINISHED,
    metadata: { finishReason: "stop" },
    usage: [
      {
        provider: "test-provider",
        model: "test-model",
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
    ],
  });
});

test("AI SDK factory runs include total token usage on RUN_FINISHED", async () => {
  const agent = new BuiltInAgent({
    type: "aisdk",
    factory: () => ({
      fullStream: (async function* () {
        yield finishPart;
      })(),
    }),
  });

  const finished = await runAndCollectFinished(agent);

  expect(finished).toMatchObject({
    type: EventType.RUN_FINISHED,
    metadata: { finishReason: "stop" },
    usage: [
      {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
    ],
  });
});

test("AI SDK approval interrupts retain total token usage", async () => {
  const agent = new BuiltInAgent({
    type: "aisdk",
    factory: () => ({
      fullStream: (async function* () {
        yield {
          type: "tool-approval-request",
          toolCallId: "tool-call-1",
          toolCall: { toolCallId: "tool-call-1", toolName: "grill" },
        };
        yield finishPart;
      })(),
    }),
  });

  const finished = await runAndCollectFinished(agent);

  expect(finished).toMatchObject({
    type: EventType.RUN_FINISHED,
    metadata: { finishReason: "stop" },
    usage: [
      {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
    ],
    outcome: {
      type: "interrupt",
      interrupts: [{ id: "tool-call-1" }],
    },
  });
});

test("TanStack factory runs aggregate usage from every model turn", async () => {
  const agent = new BuiltInAgent({
    type: "tanstack",
    factory: () =>
      (async function* () {
        yield {
          type: "RUN_FINISHED",
          model: "gpt-5-mini",
          finishReason: "tool-calls",
          metadata: { previousTurn: true },
          usage: {
            promptTokens: 10,
            completionTokens: 4,
            totalTokens: 14,
          },
        };
        yield {
          type: "RUN_FINISHED",
          model: "gpt-5-mini",
          finishReason: "stop",
          metadata: { traceId: "last-turn" },
          usage: {
            promptTokens: 12,
            completionTokens: 3,
            totalTokens: 15,
          },
        };
      })(),
  });

  const finished = await runAndCollectFinished(agent);

  expect(finished).toMatchObject({
    type: EventType.RUN_FINISHED,
    metadata: { finishReason: "stop", traceId: "last-turn" },
    usage: [
      {
        model: "gpt-5-mini",
        inputTokens: 22,
        outputTokens: 7,
        totalTokens: 29,
      },
    ],
  });
});

test("custom factory runs retain standard usage on one outer terminal event", async () => {
  const agent = new BuiltInAgent({
    type: "custom",
    factory: () =>
      (async function* () {
        yield {
          type: EventType.RUN_FINISHED,
          threadId: "inner-thread",
          runId: "inner-run",
          metadata: { finishReason: "stop", traceId: "custom-trace" },
          usage: [
            {
              provider: "anthropic",
              model: "claude-sonnet-4-6",
              inputTokens: 30,
              outputTokens: 11,
              totalTokens: 41,
            },
          ],
        };
      })(),
  });

  const finished = await runAndCollectFinished(agent);

  expect(finished).toMatchObject({
    threadId: "thread-token-usage",
    runId: "run-token-usage",
    metadata: { finishReason: "stop", traceId: "custom-trace" },
    usage: [
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 30,
        outputTokens: 11,
        totalTokens: 41,
      },
    ],
  });
});

const latestMetadataCases = [
  {
    metadata: { finishReason: "stop", traceId: "last-turn" },
    expectedMetadata: { finishReason: "stop", traceId: "last-turn" },
  },
  {
    metadata: { finishReason: "" },
    expectedMetadata: { finishReason: "" },
  },
  {
    metadata: { traceId: "last-turn" },
    expectedMetadata: { finishReason: "length", traceId: "last-turn" },
  },
  {
    metadata: { finishReason: null, traceId: "last-turn" },
    expectedMetadata: { finishReason: "length", traceId: "last-turn" },
  },
  {
    metadata: undefined,
    expectedMetadata: { finishReason: "length" },
  },
];

test.each(latestMetadataCases)(
  "custom runs retain the last supplied reason with the latest other metadata: %j",
  async ({ metadata, expectedMetadata }) => {
    const agent = new BuiltInAgent({
      type: "custom",
      factory: () =>
        (async function* () {
          yield {
            type: EventType.RUN_FINISHED,
            threadId: "inner-thread",
            runId: "first-run",
            metadata: { finishReason: "length", previousTurn: true },
          };
          yield {
            type: EventType.RUN_FINISHED,
            threadId: "inner-thread",
            runId: "last-run",
            ...(metadata ? { metadata } : {}),
          };
        })(),
    });

    const finished = await runAndCollectFinished(agent);
    expect(finished.metadata).toEqual(expectedMetadata);
  },
);

const tanStackTerminalCases = [
  {
    terminal: { finishReason: "stop", metadata: { traceId: "last-turn" } },
    expectedMetadata: { finishReason: "stop", traceId: "last-turn" },
  },
  {
    terminal: { metadata: { finishReason: "stop", traceId: "last-turn" } },
    expectedMetadata: { finishReason: "stop", traceId: "last-turn" },
  },
  {
    terminal: { metadata: { traceId: "last-turn" } },
    expectedMetadata: { finishReason: "tool-calls", traceId: "last-turn" },
  },
  { terminal: {}, expectedMetadata: { finishReason: "tool-calls" } },
  {
    terminal: { finishReason: "", metadata: { traceId: "last-turn" } },
    expectedMetadata: { finishReason: "", traceId: "last-turn" },
  },
  {
    terminal: { finishReason: null, metadata: { traceId: "last-turn" } },
    expectedMetadata: { finishReason: "tool-calls", traceId: "last-turn" },
  },
];

test.each(
  tanStackTerminalCases.flatMap((testCase) => [
    { ...testCase, usage: [{ inputTokens: 10 }] },
    { ...testCase, usage: { promptTokens: 10 } },
  ]),
)(
  "TanStack runs retain the last supplied reason with standard or native usage: %j",
  async ({ terminal, expectedMetadata, usage }) => {
    const agent = new BuiltInAgent({
      type: "tanstack",
      factory: () =>
        (async function* () {
          yield {
            type: "RUN_FINISHED",
            finishReason: "tool-calls",
            metadata: { previousTurn: true },
          };
          yield {
            type: "RUN_FINISHED",
            ...terminal,
            usage,
          };
        })(),
    });

    const finished = await runAndCollectFinished(agent);
    expect(finished.metadata).toEqual(expectedMetadata);
    expect(finished).toMatchObject({ usage: [{ inputTokens: 10 }] });
  },
);
