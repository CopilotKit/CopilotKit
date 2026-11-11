/**
 * The Claude Agent SDK agent — backend tools + the official AG-UI adapter.
 *
 * Two backend tools live in their own modules (src/query.ts, src/flights.ts).
 * The official ClaudeAgentAdapter does everything else: it drives Claude via the
 * Claude Agent SDK, bridges CopilotKit frontend tools (including the runtime's
 * render_ui generative UI tool) + human-in-the-loop, appends the run's AG-UI
 * context (the generative UI guide, app context) to the system prompt, and
 * manages the shared `todos` state via its built-in ag_ui_update_state tool.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { ClaudeAgentAdapter } from "@ag-ui/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

import { resolveModel } from "./model";
import { queryData } from "./query";
// Flight data, rendered as generative UI with render_ui
import { searchFlights } from "./flights";

// Load .env from the starter root before building the adapter (which reads the
// model from the environment); fall back to the current working directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const SYSTEM_PROMPT = [
  "You are a polished, professional demo assistant. Keep responses to 1-2 sentences.",
  "",
  "Tool guidance:",
  "",
  "- Flights: call search_flights, then show the flights with render_ui as a Row",
  "  of FlightCard components.",
  "- Dashboards & rich UI: call render_ui to build dashboards with metrics, charts,",
  "  tables, and cards from the generative UI catalog.",
  "- Charts: call query_data first, then render with the chart component.",
  "- Todos: enable app mode first, then manage todos. The todo board is shared",
  "  state under `todos`; call ag_ui_update_state with the COMPLETE list.",
  "- Generative UI actions: a click on a button you rendered (e.g. selecting a",
  "  flight) arrives as a user message. Respond with a brief confirmation.",
].join("\n");

// The Claude Agent SDK exposes custom tools through an in-process MCP server
// (createSdkMcpServer). The model calls them as mcp__<server>__<tool>, and
// allowedTools pre-approves those names so they run without a permission prompt.
// (`tools` is a different field — Claude Code's BUILT-IN toolset; [] disables it
// so the model only uses ours + the AG-UI protocol tools.)
const SERVER_NAME = "copilotkit";
const backendTools = [queryData, searchFlights];

export const adapter = new ClaudeAgentAdapter({
  agentId: "claude-sdk-typescript",
  description: "CopilotKit × Claude Agent SDK (TypeScript) starter",
  model: resolveModel(),
  systemPrompt: SYSTEM_PROMPT,
  mcpServers: {
    [SERVER_NAME]: createSdkMcpServer({
      name: SERVER_NAME,
      version: "1.0.0",
      tools: backendTools,
    }),
  },
  allowedTools: backendTools.map((tool) => `mcp__${SERVER_NAME}__${tool.name}`),
  tools: [],
  // Load no Claude Code settings: by default the SDK reads the user's and the
  // project's settings, CLAUDE.md and .mcp.json servers, so the agent would
  // pick up whatever repo or machine it runs in.
  settingSources: [],
  includePartialMessages: true,
});
