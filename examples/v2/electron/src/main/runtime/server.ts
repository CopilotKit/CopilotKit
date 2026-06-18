import {
  BuiltInAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
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

export async function startRuntimeServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const agent = new BuiltInAgent({
    model: determineModel(),
    prompt:
      "You are a helpful AI assistant running inside a local Electron desktop app.",
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
