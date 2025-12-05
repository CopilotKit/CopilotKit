/**
 * @filePath server.ts
 */
import express from "express";
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai });

const runtime = new CopilotRuntime();

const copilotRuntime = copilotRuntimeNodeHttpEndpoint({
  endpoint: "/copilotkit",
  runtime,
  serviceAdapter,
});

const app = express();

app.use("/copilotkit", copilotRuntime);

app.listen(4000, () => {
  console.log("Listening at http://localhost:4000/copilotkit");
});
