import "dotenv/config";
import { createServer } from "node:http";
import { CopilotKitIntelligence, CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { createMarketChannel } from "./create-market-channel.js";

const required = (name: "CHANNEL_CODE" | "INTELLIGENCE_API_KEY"): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const agentUrl = (): string => {
  const url = new URL(process.env.AGENT_URL ?? "http://localhost:8000/");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
};

async function assertAgentHealthy(url: string): Promise<void> {
  const response = await fetch(new URL("health", url), {
    signal: AbortSignal.timeout(3_000),
  }).catch((cause: unknown) => {
    throw new Error(`ADK agent is not reachable at ${url}`, { cause });
  });
  if (!response.ok) {
    throw new Error(`ADK health check failed with HTTP ${response.status}`);
  }
}

async function main(): Promise<void> {
  const channelName = required("CHANNEL_CODE");
  const intelligenceApiKey = required("INTELLIGENCE_API_KEY");
  const url = agentUrl();
  await assertAgentHealthy(url);
  const channel = createMarketChannel({ channelName, agentUrl: url });
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence: new CopilotKitIntelligence({ apiKey: intelligenceApiKey }),
    channels: [channel],
  });
  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
  });
  await listener.channels.ready({ timeoutMs: 30_000 });
  const detail = listener.channels.status().detail[channelName];
  if (detail?.transport !== "online" || detail.provider !== "attached") {
    await listener.channels.stop();
    throw new Error(`Managed Channel "${channelName}" is not attached`);
  }

  const server = createServer(listener);
  const port = Number(process.env.PORT ?? 8300);
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const shutdown = async (): Promise<void> => {
    await Promise.allSettled([
      listener.channels.stop(),
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    ]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  console.log(
    `[channels-a2ui] "${channelName}" is online on 127.0.0.1:${port}`,
  );
}

void main().catch((error: unknown) => {
  console.error("[channels-a2ui] startup failed", error);
  process.exit(1);
});
