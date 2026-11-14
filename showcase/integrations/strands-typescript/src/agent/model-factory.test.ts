import { afterEach, expect, it, vi } from "vitest";
import { Message, TextBlock } from "@strands-agents/sdk";
import { createModel } from "./model-factory.js";
import type { CreateModelOptions } from "./model-factory.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each<{
  name: string;
  envModel?: string;
  options: CreateModelOptions;
  expectedModel: string;
  effort?: string;
}>([
  {
    name: "Luna default",
    options: {},
    expectedModel: "gpt-6-luna",
    effort: "none",
  },
  {
    name: "environment override",
    envModel: "gpt-4o",
    options: {},
    expectedModel: "gpt-4o",
  },
  {
    name: "explicit override",
    options: { openaiModelId: "gpt-4o" },
    expectedModel: "gpt-4o",
  },
  {
    name: "explicit Luna takes precedence",
    envModel: "gpt-4o",
    options: { openaiModelId: "gpt-6-luna" },
    expectedModel: "gpt-6-luna",
    effort: "none",
  },
  {
    name: "Responses reasoning",
    options: { openaiApi: "responses", reasoning: true },
    expectedModel: "gpt-6-luna",
  },
])(
  "serializes the resolved model for $name",
  async ({ envModel, options, expectedModel, effort }) => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    vi.stubEnv("MODEL_PROVIDER", "openai");
    vi.stubEnv("MODEL_ID", envModel);
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const responses = String(url).includes("/responses");
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const events = responses
        ? [
            { type: "response.created", response: { id: "resp_test" } },
            { type: "response.output_text.delta", delta: "OK" },
            {
              type: "response.completed",
              response: { id: "resp_test", status: "completed" },
            },
          ]
        : [
            {
              id: "chatcmpl_test",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "OK" },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl_test",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const model = await createModel(options);
    for await (const _ of model.stream([
      new Message({ role: "user", content: [new TextBlock("Hello")] }),
    ])) {
      /* Drain the real SDK stream. */
    }
    expect(requests).toHaveLength(1);
    const { body } = requests[0];
    expect(body.model).toBe(expectedModel);
    if (effort) expect(body.reasoning_effort).toBe(effort);
    else expect(body).not.toHaveProperty("reasoning_effort");
    if (options.reasoning)
      expect(body.reasoning).toEqual({ effort: "medium", summary: "detailed" });
  },
);
