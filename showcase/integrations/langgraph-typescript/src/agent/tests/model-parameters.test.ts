/** Run from src/agent: node --import tsx --test tests/model-parameters.test.ts */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { graph as beautifulChat } from "../beautiful-chat";
import { graph as interruptAgent } from "../interrupt-agent";

// Generator coverage below exercises the real model serializer and toolkit,
// stubbing only the provider HTTP boundary.

for (const [name, graph] of [
  ["Beautiful Chat", beautifulChat],
  ["interrupt agent", interruptAgent],
] as const) {
  test(`${name} sends supported gpt-5-mini parameters`, async (t) => {
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "model-parameters-test";
    t.after(() => {
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    });
    const requests: Record<string, unknown>[] = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
      const request = new Request(input, init);
      requests.push(await request.json());
      return Response.json({
        id: "chatcmpl-model-parameters",
        object: "chat.completion",
        created: 0,
        model: "gpt-5-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });

    await graph.invoke(
      { messages: [new HumanMessage("Say hello.")] },
      { configurable: { thread_id: randomUUID() } },
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "gpt-5-mini");
    // GPT-5 mini supports its default temperature only. Check the serialized
    // SDK request, so a constructor or wrapper default cannot reintroduce 0.
    assert.ok(
      requests[0].temperature === undefined || requests[0].temperature === 1,
      `Unsupported temperature: ${requests[0].temperature}`,
    );
  });
}

for (const [name, modulePath] of [
  ["Beautiful Chat", "../beautiful-chat"],
  ["starter agent", "../graph"],
  ["A2UI recovery", "../recovery-agent"],
] as const) {
  test(`${name} generates a validated surface with supported model parameters`, async (t) => {
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "model-parameters-test";
    t.after(() => {
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    });
    type ProviderRequest = {
      model: string;
      temperature?: number;
      stream?: boolean;
      tools?: { function: { name: string } }[];
      messages: { role: string }[];
    };
    const requests: ProviderRequest[] = [];
    const surface = {
      surfaceId: "sales",
      components: [
        { id: "root", component: "Column", children: ["revenue"] },
        {
          id: "revenue",
          component: "Metric",
          label: "Revenue",
          value: "$327,700",
        },
      ],
    };
    t.mock.method(globalThis, "fetch", async (input, init) => {
      const request = new Request(input, init);
      const body: ProviderRequest = await request.json();
      requests.push(body);
      const generator = body.tools?.some(
        (tool) => tool.function.name === "render_a2ui",
      );
      const finished = body.messages.some((message) => message.role === "tool");
      const call = generator
        ? {
            id: "render",
            type: "function",
            function: {
              name: "render_a2ui",
              arguments: JSON.stringify(surface),
            },
          }
        : !finished
          ? {
              id: "generate",
              type: "function",
              function: {
                name: "generate_a2ui",
                arguments: JSON.stringify({ intent: "create" }),
              },
            }
          : undefined;
      const message = {
        role: "assistant",
        content: call ? "" : "Done.",
        ...(call ? { tool_calls: [call] } : {}),
      };
      const response = {
        id: "chatcmpl-generator",
        object: "chat.completion",
        created: 0,
        model: "gpt-5-mini",
        choices: [
          { index: 0, message, finish_reason: call ? "tool_calls" : "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      if (!body.stream) return Response.json(response);
      const delta = {
        ...message,
        ...(call ? { tool_calls: [{ index: 0, ...call }] } : {}),
      };
      return new Response(
        `data: ${JSON.stringify({ ...response, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    const { graph } = await import(modulePath);
    const catalog = {
      catalogId: "copilotkit://app-dashboard-catalog",
      components: {
        Column: {
          allOf: [
            {
              properties: { children: { type: "array" } },
              required: ["children"],
            },
          ],
        },
        Metric: {
          allOf: [
            {
              properties: {
                label: { type: "string" },
                value: { type: "string" },
              },
              required: ["label", "value"],
            },
          ],
        },
      },
    };
    const result = await graph.invoke(
      {
        messages: [new HumanMessage("Create a sales dashboard")],
        "ag-ui": {
          inject_a2ui_tool: true,
          context: [
            {
              description: "A2UI Component Schema",
              value: JSON.stringify(catalog),
            },
            {
              description: "A2UI usage guide",
              value: "Use flat components with root id root.",
            },
          ],
        },
      },
      { configurable: { thread_id: randomUUID() } },
    );
    const generationRequests = requests.filter((request) =>
      request.tools?.some((tool) => tool.function.name === "render_a2ui"),
    );
    assert.equal(
      generationRequests.length,
      1,
      "must reach the inner generator exactly once",
    );
    const generationResult = result.messages.find(
      (message: { tool_call_id?: string }) =>
        message.tool_call_id === "generate",
    );
    assert.ok(generationResult, "generation must return a tool result");
    const envelope = JSON.parse(String(generationResult.content));
    assert.ok(envelope.a2ui_operations, JSON.stringify(envelope));
    for (const request of requests) {
      assert.equal(request.model, "gpt-5-mini");
      assert.ok(
        request.temperature === undefined || request.temperature === 1,
        `Unsupported temperature: ${request.temperature}`,
      );
    }
  });
}
