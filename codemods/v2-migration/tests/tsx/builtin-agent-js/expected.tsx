import { CopilotRuntime } from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { anthropicText } from "@tanstack/ai-anthropic";

const runtime = new CopilotRuntime({
  agents: { default: tanstackAIAgent({ adapter: () => anthropicText("claude-sonnet-4.5"), maxIterations: 4 }) },
});

export default runtime;
