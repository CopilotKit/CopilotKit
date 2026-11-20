import { expect, it } from "vitest";
import OpenAI from "openai";
import { EventType } from "@ag-ui/client";
import { OpenAIAgent } from "./openai";

it("streams Luna through the native v4 SDK with the full tool request", async () => {
  const requests: unknown[] = [];
  const client = new OpenAI({
    apiKey: "capture-only",
    fetch: async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body)));
      const chunk = {
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-6-luna",
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
  const agent = new OpenAIAgent(client);
  const events: { type: string }[] = [];
  const parameters = { type: "object", properties: {} };
  await new Promise<void>((resolve, reject) => {
    agent
      .run({
        threadId: "thread",
        runId: "run",
        messages: [{ id: "user", role: "user", content: "Weather?" }],
        tools: [{ name: "weather", description: "Weather", parameters }],
        context: [],
        state: {},
      })
      .subscribe({
        next: (event) => events.push(event),
        error: reject,
        complete: resolve,
      });
  });
  expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  expect(requests).toEqual([
    {
      model: "gpt-6-luna",
      reasoning_effort: "none",
      stream: true,
      messages: [{ role: "user", content: "Weather?" }],
      tools: [
        {
          type: "function",
          function: { name: "weather", description: "Weather", parameters },
        },
      ],
    },
  ]);
});
