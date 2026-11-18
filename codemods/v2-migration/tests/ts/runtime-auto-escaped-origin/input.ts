import express from "express";
import { createCopilotExpressHandler } from "@copilotkit/runtime/express";
const app = express();
app.use(createCopilotExpressHandler({ runtime, basePath: "/api", cors: { origin: "\u002a", credentials: true, allowedHeaders: ["authorization"] } }));
