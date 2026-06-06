import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { NextRequest } from "next/server";

const MODEL = "openai/gpt-5";

/* ==================================================================
   /declarative — Python LangGraph agent over HTTP/SSE.
   The Python agent (agent/main.py) uses the official CopilotKit
   middleware to emit a2ui_operations from its tool result. HttpAgent
   on this side just proxies the event stream so the Next.js runtime's
   A2UI middleware can intercept and forward to the chat renderer.
   ================================================================== */

const DECLARATIVE_URL =
  process.env.DECLARATIVE_AGENT_URL ?? "http://localhost:8123/declarative";

/* HttpAgent ships against a slightly older @ag-ui/client peer than the
   runtime's; cast bridges the structural mismatch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const declarativeAgent = new HttpAgent({ url: DECLARATIVE_URL }) as any;

/* ==================================================================
   /controlled — frontend-tool agent. Classic BuiltInAgent.
   ================================================================== */

const controlledAgent = new BuiltInAgent({
  model: MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  maxSteps: 5,
  prompt: `You help the user explore a small set of stocks: AAPL, MSFT, GOOG, NVDA, TSLA, AMZN.

Two tools are available, both registered by the frontend:
- showStock(ticker) — render a card INLINE in the chat. Use when the user asks to see, view, or check a single ticker.
- pinStock(ticker) — pin a card to a workspace panel OUTSIDE the chat. Use when the user says pin, save, track, or add to my workspace.
- clearWorkspace() — empty the workspace.

Call exactly one tool when appropriate. Never describe a stock in plain text — always render or pin.`,
});

/* ==================================================================
   /open · Open Generative UI variant — streams HTML/CSS/JS to a
   sandboxed iframe in the chat via the openGenerativeUI middleware.
   ================================================================== */

const openAgent = new BuiltInAgent({
  model: MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  maxSteps: 5,
  prompt: `You build small UIs on demand and stream them into a sandboxed iframe.

When the user asks for a UI, a sketch, or to "build" something, generate HTML, CSS, and a tiny bit of JavaScript that renders the requested interface.`,
});

/* ==================================================================
   /open · MCP Apps variant — MCPAppsMiddleware attached. The agent
   uses tools exposed by the configured MCP server; their UI resources
   render automatically in the chat.
   ================================================================== */

const MCP_URL =
  process.env.MCP_APPS_SERVER_URL ?? "https://mcp.excalidraw.com/mcp";

const mcpAppsAgent = new BuiltInAgent({
  model: MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  maxSteps: 5,
  prompt: `You ONLY use tools from the connected MCP server (Excalidraw).

For ANY request that involves drawing, diagrams, flowcharts, sketches, shapes, or visuals:
1. First call \`read_me\` once to load the Excalidraw element format reference.
2. Then call \`create_view\` with valid Excalidraw elements JSON.

Do NOT emit raw HTML, SVG, markdown images, or any inline UI. The MCP server's create_view tool is the only way you render visuals here — it returns an interactive Excalidraw widget with view/edit buttons.

Be brief in plain text — let the MCP UI resource carry the response.`,
}).use(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new MCPAppsMiddleware({
    mcpServers: [{ type: "http", url: MCP_URL, serverId: "excalidraw" }],
  }) as any,
);

/* ==================================================================
   /chat-ui — generic assistant. Frontend registers the weather tool.
   ================================================================== */

const chatUiAgent = new BuiltInAgent({
  model: MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  maxSteps: 5,
  prompt: `You are a helpful assistant.

When the user asks about the weather in a city, call the showWeather tool (registered by the frontend) with a city, temperatureF, condition, humidity, and windMph. Estimate plausible values if you don't have live data. Never describe the weather in plain text when the card can be rendered.`,
});

const runtime = new CopilotRuntime({
  agents: {
    default: chatUiAgent,
    chatui: chatUiAgent,
    controlled: controlledAgent,
    declarative: declarativeAgent,
    open: openAgent,
    mcpapps: mcpAppsAgent,
  },
  a2ui: { injectA2UITool: false },
  openGenerativeUI: { agents: ["open"] },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = async (req: NextRequest) => handler(req);
export const POST = async (req: NextRequest) => handler(req);
