import { startExternalAcpRelay } from "./acp-relay";
import { createShowcaseFixtureAgent } from "./fixture-agent";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the ACP Showcase relay`);
  return value;
};

const acpWsUrl = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/acp")) return normalized;
  for (const suffix of ["/runner", "/client", "/channels"] as const) {
    if (normalized.endsWith(suffix)) {
      return `${normalized.slice(0, -suffix.length)}/acp`;
    }
  }
  return `${normalized}/acp`;
};

const fixtureAgent = createShowcaseFixtureAgent();
const relay = startExternalAcpRelay({
  agentId: required("COPILOTKIT_ACP_AGENT_ID"),
  apiKey: required("COPILOTKIT_API_KEY"),
  runtimeInstanceId: required("COPILOTKIT_ACP_RUNTIME_INSTANCE_ID"),
  wsUrl: acpWsUrl(
    process.env.COPILOTKIT_INTELLIGENCE_WS_URL ||
      "wss://realtime.intelligence.copilotkit.ai",
  ),
  onSession: ({ stream }) => fixtureAgent.connect(stream),
  onError: (error) => console.error("[acp-fixture]", error.message),
});

await relay.ready;
console.log("[acp-fixture] external ACP relay connected");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => relay.close());
}

await relay.closed;
