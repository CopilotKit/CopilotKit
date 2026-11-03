import express from "express";
import { CopilotRuntime } from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";
import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { createCopilotNodeListener } from "@copilotkit/runtime/node";

const runtime = new CopilotRuntime({
  agents: {
    default: tanstackAIAgent({ adapter: () => openaiText("gpt-5-mini") }),
  },
});

const app = express();
app.use(
  createCopilotNodeListener({
    cors: true,
    runtime,
    basePath: "/api/copilotkit",
  }),
);

const port = Number(process.env.PORT ?? 4002);
app.listen(port, () => {
  console.log(
    `Express runtime listening on http://localhost:${port}/api/copilotkit`,
  );
});
