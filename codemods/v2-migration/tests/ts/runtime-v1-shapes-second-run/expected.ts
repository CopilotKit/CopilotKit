import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";

// Already on the 2.0 API: the runtime takes agents.
export const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: openaiText("gpt-5") }) },
  runner: new InMemoryAgentRunner(),
});
