import {
  BasicAgent,
  BuiltInAgent,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { BuiltInAgent as Agent, BasicAgent as Legacy } from "@copilotkit/runtime";
import { InMemoryAgentRunner as Runtime, BuiltInAgent as Other, BasicAgent } from "@copilotkit/runtime";

export const a = new BasicAgent({ model: "openai/gpt-5" });
export const b = new BuiltInAgent({ model: "openai/gpt-5" });
export const c = new Legacy({ model: "openai/gpt-5" });
export const d = new Agent({ model: "openai/gpt-5" });
export const e = [InMemoryAgentRunner, Runtime, Other];
