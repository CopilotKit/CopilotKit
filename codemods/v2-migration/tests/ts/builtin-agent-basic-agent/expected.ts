import { CopilotRuntime } from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";

export const runtime = new CopilotRuntime({
  agents: { default: tanstackAIAgent({ adapter: () => openaiText("gpt-5.5"), maxIterations: 3 }) },
});
