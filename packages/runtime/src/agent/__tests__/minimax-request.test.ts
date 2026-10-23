import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type {
  ReasoningMessageContentEvent,
  ReasoningMessageStartEvent,
} from "@ag-ui/client";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import { BuiltInAgent, defineTool, resolveModel } from "../index";
import { collectEvents, createDefaultInput } from "./agent-test-helpers";

const stream = (deltas: Record<string, unknown>[], finishReason = "stop") =>
  new Response(
    [...deltas, {}]
      .map(
        (delta, index) =>
          `data: ${JSON.stringify({
            id: "completion",
            object: "chat.completion.chunk",
            created: 1,
            model: "MiniMax-M3.1-Flash",
            choices: [
              {
                index: 0,
                delta,
                finish_reason: index === deltas.length ? finishReason : null,
              },
            ],
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );

// Exercise BuiltInAgent -> streamText -> the real SDK serializer. Only the
// HTTP transport is mocked; no provider credentials or inference are needed.
describe("MiniMax Chat Completions requests", () => {
  const requests: Array<{
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }> = [];

  const responses: Response[] = [];

  beforeEach(() => {
    requests.length = 0;
    responses.length = 0;
    vi.stubEnv("MINIMAX_API_KEY", "test-minimax-key");
    vi.stubEnv("MINIMAX_BASE_URL", "");
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const body = await request.json();
        requests.push({ url: request.url, headers: request.headers, body });
        if (responses.length) return responses.shift()!;
        const chunk = {
          id: "test-completion",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [
            { index: 0, delta: { content: "Hello" }, finish_reason: "stop" },
          ],
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          {
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const input = () =>
    createDefaultInput({
      messages: [{ id: "user-1", role: "user", content: "Hi" }],
    });

  describe.each([
    ["default", "", "https://api.minimax.io/v1"],
    ["China", "https://api.minimaxi.com/v1", "https://api.minimaxi.com/v1"],
    [
      "custom",
      "https://gateway.example.test/v1",
      "https://gateway.example.test/v1",
    ],
  ])("%s endpoint", (_label, baseURL, expectedBaseURL) => {
    it.each([
      "MiniMax-M3.1-Flash",
      "MiniMax-M3",
      "MiniMax-M2.7",
      "custom/model:revision",
    ])(
      "streams the explicit %s model without rewriting it",
      async (modelId) => {
        vi.stubEnv("MINIMAX_BASE_URL", baseURL);
        const agent = new BuiltInAgent({
          model: `minimax:${modelId}`,
          maxRetries: 0,
        });
        const events = await collectEvents(agent.run(input()));

        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(`${expectedBaseURL}/chat/completions`);
        expect(requests[0].headers.get("authorization")).toBe(
          "Bearer test-minimax-key",
        );
        expect(requests[0].body).toMatchObject({
          model: modelId,
          stream: true,
          messages: expect.arrayContaining([{ role: "user", content: "Hi" }]),
        });
        // Omission keeps the provider's adaptive thinking / default effort.
        for (const key of [
          "thinking",
          "reasoning_effort",
          "service_tier",
          "reasoning_split",
        ]) {
          expect(requests[0].body).not.toHaveProperty(key);
        }
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: EventType.TEXT_MESSAGE_CHUNK,
              delta: "Hello",
            }),
            expect.objectContaining({ type: EventType.RUN_FINISHED }),
          ]),
        );
      },
    );
  });

  it.each(["low", "medium", "high", "xhigh"])(
    "serializes explicit Flash reasoning effort %s",
    async (reasoningEffort) => {
      const agent = new BuiltInAgent({
        model: "minimax:MiniMax-M3.1-Flash",
        maxRetries: 0,
        providerOptions: { openai: { reasoningEffort } },
      });
      await collectEvents(agent.run(input()));
      expect(requests[0].body.reasoning_effort).toBe(reasoningEffort);
      expect(requests[0].body).not.toHaveProperty("thinking");
      expect(requests[0].body).not.toHaveProperty("service_tier");
    },
  );

  it("preserves an explicitly supplied model instance and API key", async () => {
    const model = createOpenAI({
      name: "minimax",
      apiKey: "test-explicit-key",
      baseURL: "https://custom.example.test/v1",
    }).chat("saved/model:revision");
    await collectEvents(
      new BuiltInAgent({ model, maxRetries: 0 }).run(input()),
    );
    expect(requests[0].url).toBe(
      "https://custom.example.test/v1/chat/completions",
    );
    expect(requests[0].body.model).toBe("saved/model:revision");
    expect(requests[0].headers.get("authorization")).toBe(
      "Bearer test-explicit-key",
    );
  });

  const toolDelta = {
    tool_calls: [
      {
        index: 0,
        id: "call-lookup",
        type: "function",
        function: { name: "lookup", arguments: "{}" },
      },
    ],
  };

  it("preserves complete reasoning and tool results across server-side SDK steps", async () => {
    responses.push(
      stream(
        [
          { reasoning_content: "Need " },
          { reasoning_content: "lookup" },
          { content: "<think>Keep this too</think>" },
          toolDelta,
        ],
        "tool_calls",
      ),
      stream([{ reasoning_content: "Done" }, { content: "Found it" }]),
    );
    const execute = vi.fn(async () => "Lookup result");
    const agent = new BuiltInAgent({
      model: "minimax:MiniMax-M3.1-Flash",
      maxRetries: 0,
      maxSteps: 2,
      tools: [
        defineTool({
          name: "lookup",
          description: "Look up data",
          parameters: z.object({}),
          execute,
        }),
      ],
    });
    const events = await collectEvents(agent.run(input()));
    expect(execute).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    expect(requests[1].body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Need lookup",
          content: "<think>Keep this too</think>",
          tool_calls: [
            {
              id: "call-lookup",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        }),
        { role: "tool", tool_call_id: "call-lookup", content: "Lookup result" },
      ]),
    );
    expect(
      events
        .filter((event) => event.type === EventType.REASONING_MESSAGE_CONTENT)
        .map((event) => (event as ReasoningMessageContentEvent).delta),
    ).toEqual(["Need ", "lookup", "Done"]);
    const starts = events.filter(
      (event) => event.type === EventType.REASONING_MESSAGE_START,
    );
    expect(starts).toHaveLength(2);
    expect(
      new Set(
        starts.map((event) => (event as ReasoningMessageStartEvent).messageId),
      ).size,
    ).toBe(2);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("round-trips AG-UI reasoning history when resuming a client tool", async () => {
    responses.push(
      stream(
        [{ reasoning_content: "Check saved context" }, toolDelta],
        "tool_calls",
      ),
    );
    const agent = new BuiltInAgent({
      model: "minimax:MiniMax-M3.1-Flash",
      maxRetries: 0,
    });
    agent.setMessages(input().messages);
    const parameters = {
      tools: [
        {
          name: "lookup",
          description: "Look up data",
          parameters: { type: "object", properties: {} },
        },
      ],
      context: [],
      forwardedProps: {},
    };
    await agent.runAgent(parameters);
    expect(agent.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "reasoning",
          content: "Check saved context",
        }),
      ]),
    );
    agent.setMessages([
      ...agent.messages,
      {
        id: "tool-result",
        role: "tool",
        toolCallId: "call-lookup",
        content: "Saved result",
      },
    ]);
    await agent.runAgent(parameters);
    expect(requests).toHaveLength(2);
    expect(requests[1].body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Check saved context",
          tool_calls: [
            {
              id: "call-lookup",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        }),
        { role: "tool", tool_call_id: "call-lookup", content: "Saved result" },
      ]),
    );
  });

  it("retains reasoning in non-streaming SDK generation and replay", async () => {
    const response = {
      id: "completion",
      object: "chat.completion",
      created: 1,
      model: "MiniMax-M3.1-Flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Answer",
            reasoning_content: "Think first",
          },
          finish_reason: "stop",
        },
      ],
    };
    responses.push(Response.json(response), Response.json(response));
    const model = resolveModel("minimax:MiniMax-M3.1-Flash");
    const first = await generateText({ model, prompt: "Hi", maxRetries: 0 });
    expect(first.reasoningText).toBe("Think first");
    await generateText({
      model,
      messages: [
        { role: "user", content: "Hi" },
        ...first.response.messages,
        { role: "user", content: "Continue" },
      ],
      maxRetries: 0,
    });
    expect(requests[1].body.messages).toEqual(
      expect.arrayContaining([
        {
          role: "assistant",
          content: "Answer",
          reasoning_content: "Think first",
        },
      ]),
    );
  });

  it("preserves forwarded model selection, image content and tool history", async () => {
    const agent = new BuiltInAgent({
      model: "minimax:MiniMax-M3.1-Flash",
      apiKey: "test-config-key",
      maxRetries: 0,
      overridableProperties: ["model"],
    });
    await collectEvents(
      agent.run(
        createDefaultInput({
          forwardedProps: { model: "minimax/MiniMax-M2.7" },
          messages: [
            {
              id: "user-1",
              role: "user",
              content: [
                { type: "text", text: "Describe this" },
                {
                  type: "image",
                  source: {
                    type: "data",
                    value: "iVBORw0KGgo=",
                    mimeType: "image/png",
                  },
                },
              ],
            },
            {
              id: "reasoning-1",
              role: "reasoning",
              content: "Saved reasoning",
            },
            {
              id: "assistant-1",
              role: "assistant",
              content: "<think>Check the result</think>",
              toolCalls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "lookup", arguments: "{}" },
                },
              ],
            },
            {
              id: "tool-1",
              role: "tool",
              toolCallId: "call-1",
              content: "Saved result",
            },
          ],
        }),
      ),
    );
    expect(requests[0].body.model).toBe("MiniMax-M2.7");
    expect(requests[0].headers.get("authorization")).toBe(
      "Bearer test-config-key",
    );
    expect(requests[0].body.messages).toEqual(
      expect.arrayContaining([
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
            },
          ],
        },
        expect.objectContaining({
          role: "assistant",
          content: "<think>Check the result</think>",
          reasoning_content: "Saved reasoning",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        }),
        { role: "tool", tool_call_id: "call-1", content: "Saved result" },
      ]),
    );
  });
});
