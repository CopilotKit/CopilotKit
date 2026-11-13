import { Hono } from "hono";
import { createCopilotKitRuntimeHandler } from "@copilotkit/runtime";
const app = new Hono();
const copilotHandler = createCopilotKitRuntimeHandler({ cors: true, runtime, basePath: "/api" });
app.all("/api/*", (copilotContext) => copilotHandler(copilotContext.req.raw));
app.get("/health", health);
