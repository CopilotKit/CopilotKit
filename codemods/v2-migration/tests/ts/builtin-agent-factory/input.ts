import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime/v2";
import { streamText } from "ai";

const custom = new BuiltInAgent({
  type: "aisdk",
  factory: (ctx) => streamText({ model, messages: ctx.messages }),
});
const classic = new BuiltInAgent({ model: "openai/gpt-5.5" });

export const runtime = new CopilotRuntime({ agents: { custom, classic } });
