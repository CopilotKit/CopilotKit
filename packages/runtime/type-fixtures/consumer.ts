/** The generic Node listener mounts in both Express 4 and Express 5. */
import express from "express";
import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotNodeListener } from "@copilotkit/runtime/node";
const app = express();
const runtime = new CopilotRuntime({ agents: {} });
app.use(
  "/api/copilotkit",
  createCopilotNodeListener({ runtime, basePath: "/", cors: true }),
);
