import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { expect, test, vi } from "vitest";
import { BuiltInAgent } from "../index";
import { collectEvents, mockStreamTextResponse } from "./test-helpers";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

function setup(): { teardown: () => void } {
  const originalEnv = process.env;
  vi.clearAllMocks();
  process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };

  return {
    teardown: () => {
      process.env = originalEnv;
    },
  };
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
  const { teardown } = setup();

  try {
    const model = {
      specificationVersion: "v3" as const,
      modelId: "test-model",
      provider: "test-provider",
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
    };
    const agent = new BuiltInAgent({ model });
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finishPart]) as ReturnType<typeof streamText>,
    );

    const events = await collectEvents(agent.run(createInput()));

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      finishReason: "stop",
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
  } finally {
    teardown();
  }
});

test("AI SDK factory runs include total token usage on RUN_FINISHED", async () => {
  const { teardown } = setup();

  try {
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: () => ({
        fullStream: (async function* () {
          yield finishPart;
        })(),
      }),
    });

    const events = await collectEvents(agent.run(createInput()));

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      finishReason: "stop",
      usage: [
        {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
        },
      ],
    });
  } finally {
    teardown();
  }
});

test("AI SDK approval interrupts retain total token usage", async () => {
  const { teardown } = setup();

  try {
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

    const events = await collectEvents(agent.run(createInput()));

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      finishReason: "stop",
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
  } finally {
    teardown();
  }
});

test("TanStack factory runs aggregate usage from every model turn", async () => {
  const { teardown } = setup();

  try {
    const agent = new BuiltInAgent({
      type: "tanstack",
      factory: () =>
        (async function* () {
          yield {
            type: "RUN_FINISHED",
            model: "gpt-5-mini",
            usage: {
              promptTokens: 10,
              completionTokens: 4,
              totalTokens: 14,
            },
          };
          yield {
            type: "RUN_FINISHED",
            model: "gpt-5-mini",
            usage: {
              promptTokens: 12,
              completionTokens: 3,
              totalTokens: 15,
            },
          };
        })(),
    });

    const events = await collectEvents(agent.run(createInput()));

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      usage: [
        {
          model: "gpt-5-mini",
          inputTokens: 22,
          outputTokens: 7,
          totalTokens: 29,
        },
      ],
    });
  } finally {
    teardown();
  }
});

test("custom factory runs retain standard usage on one outer terminal event", async () => {
  const { teardown } = setup();

  try {
    const agent = new BuiltInAgent({
      type: "custom",
      factory: () =>
        (async function* () {
          yield {
            type: EventType.RUN_FINISHED,
            threadId: "inner-thread",
            runId: "inner-run",
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

    const events = await collectEvents(agent.run(createInput()));

    expect(
      events.filter((event) => event.type === EventType.RUN_FINISHED),
    ).toEqual([
      expect.objectContaining({
        threadId: "thread-token-usage",
        runId: "run-token-usage",
        usage: [
          {
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            inputTokens: 30,
            outputTokens: 11,
            totalTokens: 41,
          },
        ],
      }),
    ]);
  } finally {
    teardown();
  }
});
