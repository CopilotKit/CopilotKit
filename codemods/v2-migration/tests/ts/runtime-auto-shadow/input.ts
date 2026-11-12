import { createCopilotHonoHandler as create } from "@copilotkit/runtime/v2/hono";
const app = create({ runtime, basePath: "/api" });
app.fetch(request);
function local(create: Function) { return create({ runtime, basePath: "/unrelated" }); }
