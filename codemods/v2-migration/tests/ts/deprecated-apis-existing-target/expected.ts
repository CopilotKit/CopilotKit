import {
  BuiltInAgent,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";
import { InMemoryAgentRunner as Runtime, BuiltInAgent as Other, BuiltInAgent } from "@copilotkit/runtime";

export const a = tanstackAIAgent({ adapter: openaiText("gpt-5") });
export const b = tanstackAIAgent({ adapter: openaiText("gpt-5") });
export const c = tanstackAIAgent({ adapter: openaiText("gpt-5") });
export const d = tanstackAIAgent({ adapter: openaiText("gpt-5") });
export const e = [InMemoryAgentRunner, Runtime, Other];
export const f = new BuiltInAgent({ type: "aisdk", factory });
