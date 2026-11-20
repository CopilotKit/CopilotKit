import { describe, expect, it } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { EventType } from "@ag-ui/client";
import { BuiltInAgent } from "../index";
import { collectEvents, createDefaultInput } from "./agent-test-helpers";

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

function textModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<StreamPart>({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hi!" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
}

describe("BuiltInAgent system prompt through the real streamText", () => {
  it("sends the prompt when the run has no conversation messages", async () => {
    const model = textModel();
    const agent = new BuiltInAgent({ model, prompt: "Greet the user." });

    const events = await collectEvents(agent.run(createDefaultInput()));

    expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(
      false,
    );
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0].prompt).toEqual([
      { role: "system", content: "Greet the user." },
    ]);
  });

  it("sends the prompt ahead of the conversation", async () => {
    const model = textModel();
    const agent = new BuiltInAgent({ model, prompt: "Be brief." });

    const events = await collectEvents(
      agent.run(
        createDefaultInput({
          messages: [{ id: "user", role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(
      false,
    );
    expect(model.doStreamCalls[0].prompt).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });
});
