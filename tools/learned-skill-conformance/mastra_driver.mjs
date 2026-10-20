import assert from "node:assert/strict";
import { Agent } from "@mastra/core/agent";
import {
  SkillRegistry,
  createSkillRegistryProcessor,
} from "@copilotkit/intelligence-mastra";

const registry = new SkillRegistry({ freshnessWindowMs: 0 });
await registry.initialize();
const skills = createSkillRegistryProcessor({ registry });
const agent = skills.wrapAgent(
  new Agent({
    id: "learned-skill-acceptance",
    name: "Learned skill acceptance",
    model: {
      id: "openai/gpt-4o-mini",
      apiKey: "aimock",
      url: `${process.env.LEARNED_SKILL_AIMOCK_URL}/v1`,
    },
    instructions:
      "Developer policy: preserve the application's instructions above learned skills.",
    inputProcessors: [skills],
    tools: skills.tools,
  }),
);
const result = await agent.generate("Learned skill acceptance refund", {
  maxSteps: 4,
});
assert.equal(result.text, "Acceptance complete");
assert.equal(registry.status.initialized, true);
