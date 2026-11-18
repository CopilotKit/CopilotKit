import express from "express";
import { createCopilotExpressHandler } from "@copilotkit/runtime/express";
const app = express();
app.use("/api", createCopilotExpressHandler({ runtime, basePath: "/rpc", mode: "single-route" }));
