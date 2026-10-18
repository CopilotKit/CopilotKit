import { describe, expect, it } from "vitest";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { BuiltInAgent } from "../index";
import {
  collectEvents,
  createClassicAgentWithTools,
  createDefaultInput,
} from "./agent-test-helpers";
import { textDelta, finish } from "./test-helpers";

describe("BuiltInAgent tool-call history sanitization", () => {
  it.each(["user", "assistant"] as const)(
    "inserts resume results before a later %s message",
    async (role) => {
      const agent = createClassicAgentWithTools(
        [textDelta("Done"), finish()],
        [],
      );
      const events = await collectEvents(
        agent.run(
          createDefaultInput({
            resume: [
              {
                interruptId: "confirm-1",
                status: "resolved",
                payload: { approved: true },
              },
            ],
            messages: [
              { id: "u1", role: "user", content: "Start" },
              {
                id: "a1",
                role: "assistant",
                content: "",
                toolCalls: [
                  {
                    id: "confirm-1",
                    type: "function",
                    function: { name: "confirm", arguments: "{}" },
                  },
                ],
              },
              { id: "later", role, content: "Continue" },
            ],
          }),
        ),
      );

      expect(
        events.filter((event) => event.type === EventType.RUN_ERROR),
      ).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: EventType.RUN_FINISHED });
      expect(agent.__lastModelMessages?.map((message) => message.role)).toEqual(
        ["user", "assistant", "tool", role],
      );
      expect(agent.__lastModelMessages?.[2]).toMatchObject({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "confirm-1",
            toolName: "confirm",
            output: { type: "json", value: { approved: true } },
          },
        ],
      });
    },
  );

  it("continues when a prior assistant message has an unanswered call", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Done" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 0,
                  noCache: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 0, text: 0, reasoning: 0 },
              },
            },
          ],
        }),
      }),
    });
    const agent = new BuiltInAgent({ model });

    const input: RunAgentInput = {
      threadId: "thread-7100",
      runId: "run-7100",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "lookup-1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "show-card-1",
              type: "function",
              function: { name: "show_card", arguments: "{}" },
            },
          ],
        },
        {
          id: "tool-2",
          role: "tool",
          toolCallId: "show-card-1",
          content: "Rendered",
        },
        { id: "user-1", role: "user", content: "Continue" },
      ],
      tools: [],
      context: [],
      state: {},
    };

    const events = await collectEvents(agent.run(input));

    expect(events.at(-1)).toMatchObject({ type: EventType.RUN_FINISHED });
    expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(
      false,
    );
  });
});
