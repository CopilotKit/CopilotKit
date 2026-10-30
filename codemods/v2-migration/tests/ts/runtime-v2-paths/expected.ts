import { CopilotRuntime, BuiltInAgent } from "@copilotkit/runtime";
import { createCopilotExpressHandler } from "@copilotkit/runtime/express";
import { createCopilotHonoHandler } from "@copilotkit/runtime/hono";

export const runtime = new CopilotRuntime({ agents: { default: new BuiltInAgent({ model: "openai/gpt-5" }) } });
