import { createCopilotHonoHandler } from "@copilotkit/runtime/hono";
const app = createCopilotHonoHandler({ runtime, basePath: "/api" });
app.fetch(request);
consume({ app });
