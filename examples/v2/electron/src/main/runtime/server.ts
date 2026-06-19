import {
  BuiltInAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { ToolDefinition, MCPClientProvider } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export function determineModel(): string {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-5.2";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-3-7-sonnet-20250219";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-5.2";
}

export interface RunningRuntime {
  url: string;
  close: () => Promise<void>;
}

export async function startRuntimeServer(opts?: {
  tools?: ToolDefinition[];
  mcpClients?: MCPClientProvider[];
}): Promise<RunningRuntime> {
  const agent = new BuiltInAgent({
    model: determineModel(),
    prompt:
      "You are a helpful AI assistant running inside a local Electron desktop app. " +
      "You can read the workspace using the fs_list, fs_read, and fs_search tools. " +
      "You can propose fs_write and shell_run actions, but these require explicit human approval before they run. " +
      "You may also have tools provided by connected MCP servers — use them when relevant.",
    maxSteps: 10,
    tools: opts?.tools ?? [],
    mcpClients: opts?.mcpClients ?? [],
  });

  const runtime = new CopilotRuntime({
    agents: { default: agent },
    runner: new InMemoryAgentRunner(),
  });

  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  });

  const server = createServer(listener);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}/api/copilotkit`;
      const close = () => new Promise<void>((res) => server.close(() => res()));
      resolve({ url, close });
    });
  });
}
