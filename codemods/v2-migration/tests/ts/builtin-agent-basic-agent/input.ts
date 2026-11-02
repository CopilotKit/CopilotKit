import { BasicAgent, CopilotRuntime } from "@copilotkit/runtime/v2";

export const runtime = new CopilotRuntime({
  agents: { default: new BasicAgent({ model: "openai/gpt-5.4", maxSteps: 3 }) },
});
