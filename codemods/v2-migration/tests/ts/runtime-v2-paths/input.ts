import { CopilotRuntime, BuiltInAgent } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import { createCopilotHonoHandler } from "@copilotkit/runtime/v2/hono";

export const runtime = new CopilotRuntime({ agents: { default: new BuiltInAgent({ model: "openai/gpt-5" }) } });
