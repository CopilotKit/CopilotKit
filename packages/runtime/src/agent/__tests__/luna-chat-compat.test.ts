import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { BuiltInAgent } from "../index";
import { collectEvents, finish, mockStreamTextResponse } from "./test-helpers";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  jsonSchema: vi.fn((schema) => schema),
  stepCountIs: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () =>
    Object.assign(
      (modelId: string) => ({ modelId, provider: "openai.responses" }),
      { chat: (modelId: string) => ({ modelId, provider: "openai.chat" }) },
    ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Luna tool calling transport", () => {
  it.each(["chat", "responses"])(
    "uses compatible options for %s",
    async (api) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.stubEnv("COPILOTKIT_OPENAI_API", api);
      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );
      const agent = new BuiltInAgent({
        model: "openai/gpt-6-luna",
        providerOptions: {
          openai: { reasoningEffort: "medium", store: false },
        },
      });
      await collectEvents(
        agent["run"]({
          threadId: "thread",
          runId: "run",
          messages: [{ id: "user", role: "user", content: "Hello" }],
          tools: [
            {
              name: "weather",
              description: "Weather",
              parameters: { type: "object", properties: {} },
            },
          ],
          context: [],
          state: {},
        }),
      );
      expect(streamText).toHaveBeenCalledOnce();
      expect(vi.mocked(streamText).mock.calls[0][0].providerOptions).toEqual({
        openai: {
          reasoningEffort: api === "chat" ? "none" : "medium",
          store: false,
        },
      });
    },
  );
});
