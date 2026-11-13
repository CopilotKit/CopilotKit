import express from "express";
import { CopilotKitRuntime } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";
import { createCopilotKitNodeListener } from "@copilotkit/runtime/node";

const runtime = new CopilotKitRuntime({
  agents: {
    default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }),
  },
});

const app = express();
app.use(
  createCopilotKitNodeListener({
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
