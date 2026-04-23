import * as http from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { BuiltInAgent, CopilotSseRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

interface SubprocessConfig {
  port: number;
  llmBaseUrl: string;
  provider: "openai" | "anthropic";
  model: string;
  apiKey: string;
}

function parseConfig(): SubprocessConfig {
  const raw = process.env.COPILOTKIT_PLAYGROUND_CONFIG;
  if (!raw) {
    throw new Error(
      "subprocess-entry requires a JSON config in COPILOTKIT_PLAYGROUND_CONFIG env var: {port, llmBaseUrl, provider, model, apiKey}",
    );
  }
  return JSON.parse(raw) as SubprocessConfig;
}

async function main(): Promise<void> {
  const config = parseConfig();

  if (config.provider !== "openai") {
    throw new Error(
      `Plan #3 scope: provider "${config.provider}" not wired yet. Add an adapter case here.`,
    );
  }

  // Build an @ai-sdk/openai provider with the mock base URL so all LLM
  // traffic is intercepted by aimock instead of hitting OpenAI directly.
  const openaiProvider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.llmBaseUrl,
  });

  const languageModel = openaiProvider(config.model);

  // BuiltInAgent with classic config — handles streamText, tools, and state.
  const agent = new BuiltInAgent({
    model: languageModel,
  });

  const runtime = new CopilotSseRuntime({
    agents: { default: agent },
  });

  const listener = createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  });

  const server = http.createServer(listener);
  server.listen(config.port, "127.0.0.1", () => {
    const address = server.address();
    const boundPort =
      typeof address === "object" && address !== null ? address.port : 0;
    process.stdout.write(
      JSON.stringify({ ready: true, port: boundPort }) + "\n",
    );
  });

  const shutdown = (): void => {
    // closeAllConnections destroys keep-alive/SSE sockets immediately so
    // server.close() can resolve — without it, open streams block shutdown
    // indefinitely and the parent has to SIGKILL.
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close(() => process.exit(0));
    // Hard timeout in case something still hangs.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      error: true,
      message: err instanceof Error ? err.message : String(err),
    }) + "\n",
  );
  process.exit(1);
});
