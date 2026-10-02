/** Run from src/agent: node --import tsx --test tests/model-parameters.test.ts */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { graph as beautifulChat } from "../beautiful-chat";
import { graph as interruptAgent } from "../interrupt-agent";

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
