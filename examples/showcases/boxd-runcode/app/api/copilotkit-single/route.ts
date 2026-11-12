import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpointSingleRoute,
  BuiltInAgent,
  defineTool,
} from "@copilotkit/runtime/v2";
import { Boxd } from "@boxd-sh/sdk";
import { handle } from "hono/vercel";
import { z } from "zod";

// --- The cookbook recipe: a server tool that runs code on a boxd machine ---
const boxd = new Boxd(); // reads BOXD_API_KEY

// File name and interpreter per language. Node strips TypeScript types, so
// TypeScript must use erasable syntax only (no enums or namespaces).
const runners = {
  python: { file: "main.py", command: "python3" },
  typescript: { file: "main.ts", command: "node" },
  javascript: { file: "main.js", command: "node" },
} as const;

const runCode = defineTool({
  name: "runCode",
  description:
    "Execute code on an isolated boxd machine and return its output.",
  parameters: z.object({
    code: z.string().describe("The code to run on the machine"),
    language: z
      .enum(["python", "typescript", "javascript"])
      .default("python")
      .describe(
        "Language runtime for the code. TypeScript runs on Node with type stripping: no enums or namespaces.",
      ),
  }),
  execute: async ({ code, language }) => {
    const machine = await boxd.machines.create({
      org: process.env.BOXD_ORG,
      isolated: true,
    });
    try {
      await boxd.machines.waitUntilReady(machine.id);
      const { file, command } = runners[language];
      const path = `/home/boxd/runcode/${file}`;
      await boxd.machines.fs.write(machine.id, path, code);
      const res = await boxd.machines.exec(machine.id, {
        command: [command, path],
        timeout: 60_000,
      });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    } finally {
      await boxd.machines
        .delete(machine.id)
        .catch((err) =>
          console.error(`Failed to delete machine ${machine.id}`, err),
        );
    }
  },
});

const agent = new BuiltInAgent({
  model: process.env.MODEL ?? "openai:gpt-6-luna",
  prompt:
    "You are a coding assistant. When the user asks you to run, execute, or compute " +
    "something with code, use the runCode tool to run it on a boxd machine. " +
    "Default to Python unless told otherwise. " +
    "IMPORTANT: the tool's output (stdout, stderr and exit code) is rendered directly to " +
    "the user in a separate UI panel; the user can already see it. Do NOT repeat, restate, " +
    "or include the output or the generated code in your reply. Acknowledge briefly (a " +
    "single short sentence) or stay silent. Never reproduce content that already appears " +
    "in the tool card.",
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
