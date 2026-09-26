import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const agent = new BuiltInAgent({
  model: "openai/gpt-5.5",
  // When to reach for the map, and a reminder to stick to real data.
  prompt:
    "You are an operations copilot. To map orders, call show-map with the map arguments from context. " +
    "Each call replaces the map, so always pass the complete marker set. Never invent locations.",
});

const runtime = new CopilotRuntime({
  agents: { default: agent },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: process.env.MAP_MCP_URL ?? "http://localhost:3001/mcp",
        // Any name you like. Keep it the same when the URL changes.
        serverId: "fizzy-maps",
      },
    ],
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
