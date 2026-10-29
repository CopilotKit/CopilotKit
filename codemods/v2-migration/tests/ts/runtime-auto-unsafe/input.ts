import { createCopilotExpressHandler } from "@copilotkit/runtime/express";
import { createCopilotHonoHandler } from "@copilotkit/runtime/hono";
const router = createCopilotExpressHandler({ runtime, basePath: "/api" });
router.get("/custom", custom);
app.use(router);
const endpoint = createCopilotHonoHandler({ runtime, basePath: "/api", cors: { origin: (origin, context) => context.req.header("origin") } });
endpoint.fetch(request);
