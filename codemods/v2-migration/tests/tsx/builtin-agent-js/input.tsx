import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: "anthropic/claude-sonnet-4.5", maxSteps: 4 }) },
});

export default runtime;
