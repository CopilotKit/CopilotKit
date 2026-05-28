// Daytona "runCode" server tool for a CopilotKit Built-in Agent.
//
// Prerequisites:
//   npm install @daytonaio/sdk
//
// Environment variables:
//   DAYTONA_API_KEY=...   (create at https://app.daytona.io/dashboard/keys)
//
// Drop this into the module that constructs your BuiltInAgent (e.g. your runtime route),
// then add `runCode` to the agent's `tools` array and set `maxSteps: 2`.

import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { Daytona } from "@daytonaio/sdk";
import { z } from "zod";

const daytona = new Daytona(); // reads DAYTONA_API_KEY

export const runCode = defineTool({
  name: "runCode",
  description:
    "Execute code in an isolated Daytona sandbox and return its output.",
  parameters: z.object({
    code: z.string().describe("The code to run in the sandbox"),
    language: z
      .enum(["python", "typescript", "javascript"])
      .default("python")
      .describe("Language runtime for the code"),
  }),
  execute: async ({ code, language }) => {
    const sandbox = await daytona.create({ language });
    try {
      const res = await sandbox.process.codeRun(code);
      return { stdout: res.result, exitCode: res.exitCode };
    } finally {
      await sandbox.delete();
    }
  },
});

// Register it on your existing Built-in Agent (keep your current model + runtime wiring):
export const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  tools: [runCode],
  maxSteps: 2, // required so the agent can call the tool and then respond
});
