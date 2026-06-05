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
they lack permission rather than attempting it.

When you call the showTransactions tool, the rendered list is the single
source of truth for the user. Do NOT restate transaction counts, totals,
or per-row details in prose — the list already shows them. Keep any
accompanying message to at most one short sentence (e.g. "Here are your
recent transactions.") and let the rendered list speak for itself.`,
  temperature: 0.3,
});

const runtime = new CopilotRuntime({
  agents: { default: bankingAgent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
