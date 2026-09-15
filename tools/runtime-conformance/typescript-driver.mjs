import { createServer } from "node:http";

const configuration = JSON.parse(process.env.CPK_CONFIG);
// The public TypeScript runtime configures its process-wide sink at import time.
process.env.COPILOTKIT_TELEMETRY_URL = configuration.telemetryUrl;
process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE ??= String(
  configuration.telemetrySampleRate ?? 1,
);
if (configuration.telemetryDisabled)
  process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

const { CopilotIntelligenceRuntime, CopilotKitIntelligence } =
  await import("@copilotkit/runtime/v2");
const { createCopilotNodeListener } =
  await import("@copilotkit/runtime/v2/node");
const { HttpAgent } = await import("@ag-ui/client");

const intelligence = new CopilotKitIntelligence({
  apiKey: configuration.apiKey,
  apiUrl: configuration.apiUrl,
  wsUrl: configuration.runnerUrl.replace(/\/runner\/?$/, ""),
});
const runtime = new CopilotIntelligenceRuntime({
  intelligence,
  agents: {
    default: new HttpAgent({
      url: configuration.agentUrl,
      description: "Conformance agent",
    }),
  },
  identifyUser: (request) => ({
    id: request.headers.get("x-test-user-id") ?? "test-user",
    name: request.headers.get("x-test-user-name") ?? "Test User",
  }),
  generateThreadNames: false,
  exposeMemoryRoutes: true,
  ...(!configuration.omitMemoryPolicy &&
  Object.hasOwn(configuration, "memoryGrant")
    ? { memory: { access: () => configuration.memoryGrant } }
    : {}),
  telemetryId: configuration.telemetryId,
  licenseToken: configuration.licenseToken,
  a2ui: configuration.a2ui,
  mcpApps: configuration.mcpApps,
});
const listener = createCopilotNodeListener({
  runtime,
  basePath: "/copilotkit",
  mode: "multi-route",
});
const server = createServer(listener);
server.listen(configuration.port ?? 0, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
});

/** Close fixture HTTP resources when the harness ends this isolated process. */
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
