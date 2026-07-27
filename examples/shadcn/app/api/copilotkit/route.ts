import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

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
});

export const POST = async (request: Request) => {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      "Missing OPENAI_API_KEY. Set it in examples/shadcn/.env.local and restart the dev server.",
      { status: 500 },
    );
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
};
