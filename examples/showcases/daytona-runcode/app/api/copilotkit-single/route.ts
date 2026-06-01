import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpointSingleRoute,
  BuiltInAgent,
  defineTool,
} from "@copilotkit/runtime/v2";
import { Daytona } from "@daytonaio/sdk";
import { handle } from "hono/vercel";
import { z } from "zod";

// --- The cookbook recipe: a server tool that runs code in a Daytona sandbox ---
const daytona = new Daytona(); // reads DAYTONA_API_KEY

const runCode = defineTool({
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

const agent = new BuiltInAgent({
  model: process.env.MODEL ?? "openai:gpt-5.4-mini",
  prompt:
    "You are a coding assistant. When the user asks you to run, execute, or compute " +
    "something with code, use the runCode tool to run it in a Daytona sandbox. " +
    "Default to Python unless told otherwise. " +
    "IMPORTANT: the tool's output (stdout + exit code) is rendered directly to the user " +
    "in a separate UI panel; the user can already see it. Do NOT repeat, restate, or " +
    "include the stdout or the generated code in your reply. Acknowledge briefly (a single " +
    "short sentence) or stay silent. Never reproduce content that already appears in the " +
    "tool card.",
  tools: [runCode],
  maxSteps: 2,
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/api/copilotkit-single",
});

export const POST = handle(app);
