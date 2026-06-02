import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const bankingAgent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: `You are the Northwind Copilot, an assistant embedded in a corporate
banking dashboard. You help users view transactions, manage credit cards,
assign expense policies, and navigate the app. Use the provided tools. Respect
the user's role: if a tool is unavailable to the current user, explain that
they lack permission rather than attempting it.`,
  temperature: 0.3,
});

const runtime = new CopilotRuntime({
  agents: { default: bankingAgent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
