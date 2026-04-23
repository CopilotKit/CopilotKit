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
  const raw = process.argv[2];
  if (!raw) {
    throw new Error(
      "subprocess-entry requires a JSON config as argv[2]: {port, llmBaseUrl, provider, model, apiKey}",
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

  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
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
