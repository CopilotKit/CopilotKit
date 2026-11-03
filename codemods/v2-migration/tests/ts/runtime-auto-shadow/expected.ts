// TODO(copilotkit-2.0): Express/Hono adapters were removed in 2.0. Use createCopilotRuntimeHandler from "@copilotkit/runtime" (Request => Response), or createCopilotNodeListener from "@copilotkit/runtime/node". Remove handle(app)/.fetch wrappers, set mode: "single-route" for single endpoints, and set cors explicitly. Router methods and framework CORS options require manual migration. See https://docs.copilotkit.ai/migrate/runtime-2.0
import { createCopilotHonoHandler as create } from "@copilotkit/runtime/v2/hono";
const app = create({ runtime, basePath: "/api" });
app.fetch(request);
function local(create: Function) { return create({ runtime, basePath: "/unrelated" }); }
