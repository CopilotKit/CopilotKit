import assert from "node:assert/strict";
import test from "node:test";
import {
  DYNAMIC_A2UI_SYSTEM_PROMPT,
  RENDER_A2UI_TOOL,
} from "./a2ui-contract.js";

for (const model of ["gpt-6-luna", "custom-chat-model"]) {
  test(`A2UI preserves the full SDK request for ${model}`, async (t) => {
    const oldModel = process.env.COPILOTKIT_AGENT_MODEL;
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.COPILOTKIT_AGENT_MODEL = `openai:${model}`;
    process.env.OPENAI_API_KEY = "request-capture-only";
    t.after(() => {
      if (oldModel === undefined) delete process.env.COPILOTKIT_AGENT_MODEL;
      else process.env.COPILOTKIT_AGENT_MODEL = oldModel;
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    });
    const requests: unknown[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (...[input, init]: Parameters<typeof fetch>) => {
        requests.push(await new Request(input, init).json());
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model,
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "render",
                    type: "function",
                    function: {
                      name: "render_a2ui",
                      arguments: JSON.stringify({
                        surfaceId: "dashboard",
                        components: [{ id: "root", component: "Column" }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      },
    );
    // Each model gets its own module instance: model selection occurs at boot.
    const { generateA2ui } = await import(
      new URL(`./agent.ts?model=${model}`, import.meta.url).href
    );
    await generateA2ui.invoke({ user_intent: "Show revenue" });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      model,
      messages: [
        { role: "system", content: DYNAMIC_A2UI_SYSTEM_PROMPT },
        { role: "user", content: "Show revenue" },
      ],
      tools: [RENDER_A2UI_TOOL],
      tool_choice: { type: "function", function: { name: "render_a2ui" } },
      ...(model === "gpt-6-luna" ? { reasoning_effort: "none" } : {}),
    });
  });
}
