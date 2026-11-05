import {
  BuiltInAgent,
} from "@copilotkit/runtime/agent";
import {
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent as Agent, BuiltInAgent as Legacy } from "@copilotkit/runtime/agent";
import { InMemoryAgentRunner as Runtime } from "@copilotkit/runtime";
import { BuiltInAgent as Other, BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

export const a = new BuiltInAgent({ model: openaiText("gpt-5") });
export const b = new BuiltInAgent({ model: openaiText("gpt-5") });
export const c = new Legacy({ model: openaiText("gpt-5") });
export const d = new Agent({ model: openaiText("gpt-5") });
export const e = [InMemoryAgentRunner, Runtime, Other];
