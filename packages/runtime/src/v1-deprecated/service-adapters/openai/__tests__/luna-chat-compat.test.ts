import { describe, expect, it, vi } from "vitest";
import { OpenAIAdapter } from "../openai-adapter";
import OpenAI from "openai";

describe("OpenAIAdapter Luna requests", () => {
  it.each([undefined, "gpt-6-luna", "gpt-4o"])(
    "keeps Chat tool calling compatible for %s",
    async (model) => {
      const stream = vi.fn(
        (_request: any, _options?: { body?: unknown }) => [],
      );
      const adapter = new OpenAIAdapter({
        model,
        openai: { chat: { completions: { stream } } } as unknown as OpenAI,
      });
      await adapter.process({
        messages: [],
        actions: [],
        eventSource: { stream: vi.fn() },
      } as any);
      expect(stream).toHaveBeenCalledOnce();
      const [body, options] = stream.mock.calls[0];
      const request = (options?.body ?? body) as any;
      expect(request.model).toBe(model ?? "gpt-6-luna");
      expect(request.reasoning_effort).toBe(
        model === "gpt-4o" ? undefined : "none",
      );
    },
  );
});

describe("native OpenAI v4 stream request body", () => {
  it.each(["gpt-6-luna", "gpt-4o"])(
    "preserves all streaming fields for %s",
    async (model) => {
      const requests: unknown[] = [];
      const client = new OpenAI({
        apiKey: "capture-only",
        fetch: async (_url: unknown, init?: { body?: unknown }) => {
          requests.push(JSON.parse(String(init?.body)));
          const chunk = {
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 1,
            model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Sunny" },
                finish_reason: "stop",
              },
            ],
          };
          return new Response(
            `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          );
        },
      });
      const complete = vi.fn();
      const eventStream = {
        sendTextMessageStart: vi.fn(),
        sendTextMessageContent: vi.fn(),
        sendTextMessageEnd: vi.fn(),
        complete,
      };
      let consumption = Promise.resolve();
      const adapter = new OpenAIAdapter({
        openai: client,
        model,
        disableParallelToolCalls: true,
      });
      const parameters = { type: "object", properties: {} };
      await adapter.process({
        messages: [],
        actions: [
          {
            name: "weather",
            description: "Weather",
            jsonSchema: JSON.stringify(parameters),
          },
        ],
        forwardedParameters: {
          maxTokens: 32,
          temperature: 0.3,
          stop: ["END"],
          toolChoice: "auto",
        },
        eventSource: {
          stream: (callback: (events: typeof eventStream) => Promise<void>) => {
            consumption = callback(eventStream);
          },
        },
      } as any);
      await consumption;
      expect(complete).toHaveBeenCalledOnce();
      expect(requests).toEqual([
        {
          model,
          stream: true,
          messages: [],
          tools: [
            {
              type: "function",
              function: { name: "weather", description: "Weather", parameters },
            },
          ],
          max_completion_tokens: 32,
          stop: ["END"],
          tool_choice: "auto",
          parallel_tool_calls: false,
          temperature: 0.3,
          ...(model === "gpt-6-luna" ? { reasoning_effort: "none" } : {}),
        },
      ]);
    },
  );
});
