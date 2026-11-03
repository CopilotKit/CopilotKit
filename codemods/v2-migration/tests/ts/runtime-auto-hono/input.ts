import { Hono } from "hono";
import { createCopilotHonoHandler } from "@copilotkit/runtime/hono";
const app = new Hono();
app.route("/", createCopilotHonoHandler({ runtime, basePath: "/api" }));
app.get("/health", health);
