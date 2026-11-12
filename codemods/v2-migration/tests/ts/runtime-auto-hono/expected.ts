import { Hono } from "hono";
import { createCopilotRuntimeHandler } from "@copilotkit/runtime";
const app = new Hono();
const copilotHandler = createCopilotRuntimeHandler({ cors: true, runtime, basePath: "/api" });
app.all("/api/*", (copilotContext) => copilotHandler(copilotContext.req.raw));
app.get("/health", health);
