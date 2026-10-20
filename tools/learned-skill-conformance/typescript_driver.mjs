import assert from "node:assert/strict";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import {
  SkillRegistry,
  createSkillRegistryMiddleware,
} from "@copilotkit/intelligence-langgraph";

const registry = new SkillRegistry({ freshnessWindowMs: 0 });
await registry.initialize();
const skills = createSkillRegistryMiddleware({ registry });
const agent = skills.wrapAgent(
  createAgent({
    model: new ChatOpenAI({
      model: "gpt-4o-mini",
      apiKey: "aimock",
      configuration: { baseURL: `${process.env.LEARNED_SKILL_AIMOCK_URL}/v1` },
      maxRetries: 0,
    }),
    systemPrompt:
      "Developer policy: preserve the application's instructions above learned skills.",
    middleware: [skills],
  }),
);
const result = await agent.invoke({
  messages: [{ role: "user", content: "Learned skill acceptance refund" }],
});
assert.equal(result.messages.at(-1)?.text, "Acceptance complete");
assert.equal(registry.status.initialized, true);
