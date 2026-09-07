import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[copilotkit] OPENAI_API_KEY is not set. Chat turns will fail until you set it in examples/shadcn/.env.local and restart the dev server.",
  );
}

const agent = new BuiltInAgent({
  model: process.env.COPILOTKIT_MODEL ?? "openai/gpt-5.4",
  prompt: `
You are a concise assistant for a CopilotKit + ShadCN demo.
Answer briefly. Use renderLineChart only when the user asks for a chart, and
call it exactly once. Use makeItRain only when the user asks for the taco rain
picker or emoji picker. Keep surrounding text short.
`,
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
