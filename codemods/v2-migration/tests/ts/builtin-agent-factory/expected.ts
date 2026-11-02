import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";
import { streamText } from "ai";

const custom = new BuiltInAgent({
  type: "aisdk",
  factory: (ctx) => streamText({ model, messages: ctx.messages }),
});
const classic = tanstackAIAgent({ adapter: openaiText("gpt-5.5") });

export const runtime = new CopilotRuntime({ agents: { custom, classic } });
