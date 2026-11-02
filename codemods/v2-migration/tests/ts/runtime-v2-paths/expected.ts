import { CopilotRuntime } from "@copilotkit/runtime";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";
// TODO(copilotkit-2.0): Express/Hono adapters were removed in 2.0. Use createCopilotRuntimeHandler from "@copilotkit/runtime" (Request => Response), or createCopilotNodeListener from "@copilotkit/runtime/node". Remove handle(app)/.fetch wrappers, set mode: "single-route" for single endpoints, and set cors explicitly. Router methods and framework CORS options require manual migration. See https://docs.copilotkit.ai/migrate/runtime-2.0
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
// TODO(copilotkit-2.0): Express/Hono adapters were removed in 2.0. Use createCopilotRuntimeHandler from "@copilotkit/runtime" (Request => Response), or createCopilotNodeListener from "@copilotkit/runtime/node". Remove handle(app)/.fetch wrappers, set mode: "single-route" for single endpoints, and set cors explicitly. Router methods and framework CORS options require manual migration. See https://docs.copilotkit.ai/migrate/runtime-2.0
import { createCopilotHonoHandler } from "@copilotkit/runtime/v2/hono";

export const runtime = new CopilotRuntime({ agents: { default: tanstackAIAgent({ adapter: openaiText("gpt-5") }) } });
