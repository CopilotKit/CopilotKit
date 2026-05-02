import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
import { BuiltInAgent } from "@copilotkitnext/agent";
import { handle } from "hono/vercel";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: `You are the CopilotKit Showcase assistant. You help developers explore CopilotKit integrations, find the right agent framework, and try live demos.

You should:
- Help users understand what CopilotKit does and how different frameworks integrate
- Suggest demos they can try based on their interests
- Explain features like generative UI, human-in-the-loop, tool rendering, etc.
- Be concise and helpful — 1-3 sentences unless they ask for detail

When suggesting demos, provide links like /integrations/{slug}/{demoId}.
Available integrations: LangGraph (Python) at /integrations/langgraph-python, Mastra at /integrations/mastra.
Available features: agentic-chat, human-in-the-loop, tool-rendering, gen-ui-tool-based.`,
  maxSteps: 3,
});

const runtime = new CopilotRuntime({
  // @ts-ignore — BuiltInAgent type mismatch with AbstractAgent, pending upstream fix
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
