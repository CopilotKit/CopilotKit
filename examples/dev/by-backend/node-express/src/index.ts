import express from "express";
import dotenv from "dotenv";
import { z } from "zod";
import type { ToolDefinition } from "@copilotkit/runtime";
import { CopilotRuntime, BuiltInAgent, defineTool } from "@copilotkit/runtime";
import { createCopilotNodeListener } from "@copilotkit/runtime/node";

dotenv.config();

const roastTool = defineTool({
  name: "sayHello",
  description: "Say hello while roasting the user's name",
  parameters: z.object({
    roast: z.string().describe("A playful roast about the user's name"),
  }),
  execute: async ({ roast }) => {
    console.log(roast);
    return "The person has been roasted.";
  },
}) as unknown as ToolDefinition;

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-5-mini",
      tools: [roastTool],
    }),
  },
});

const app = express();

app.use(
  "/api/copilotkit",
  createCopilotNodeListener({
    mode: "single-route",
    cors: true,
    runtime,
    basePath: "/",
  }),
);

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(
    `CopilotKit v2 runtime listening at http://localhost:${port}/api/copilotkit`,
  );
});
