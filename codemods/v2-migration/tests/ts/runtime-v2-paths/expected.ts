import { CopilotKitRuntime } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
// TODO(copilotkit-2.0): Express/Hono adapters were removed in 2.0. Use createCopilotKitRuntimeHandler from "@copilotkit/runtime" (Request => Response), or createCopilotKitNodeListener from "@copilotkit/runtime/node". Remove handle(app)/.fetch wrappers, set mode: "single-route" for single endpoints, and set cors explicitly. Router methods and framework CORS options require manual migration. See https://docs.copilotkit.ai/migrate/runtime-2.0
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
// TODO(copilotkit-2.0): Express/Hono adapters were removed in 2.0. Use createCopilotKitRuntimeHandler from "@copilotkit/runtime" (Request => Response), or createCopilotKitNodeListener from "@copilotkit/runtime/node". Remove handle(app)/.fetch wrappers, set mode: "single-route" for single endpoints, and set cors explicitly. Router methods and framework CORS options require manual migration. See https://docs.copilotkit.ai/migrate/runtime-2.0
import { createCopilotHonoHandler } from "@copilotkit/runtime/v2/hono";
import { openaiText } from "@tanstack/ai-openai";

export const runtime = new CopilotKitRuntime({ agents: { default: new BuiltInAgent({ model: openaiText("gpt-5") }) } });
