import express from "express";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
const app = express();
app.use(createCopilotExpressHandler({ runtime, basePath: "/api/copilotkit", cors: { origin: "https://example.com", credentials: true, allowedHeaders: ["authorization"], methods: "GET,POST" } }));
app.get("/health", health);
