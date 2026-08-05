import {
  AcpAgent,
  CopilotKitIntelligence,
  CopilotRuntime,
} from "@copilotkit/runtime/v2";

const AGENT_IDS = [
  "agentic_chat",
  "reasoning-default",
  "prebuilt-sidebar",
] as const;

const requiredEnvironment = (): {
  agentId: string;
  apiKey: string;
  cwd: string;
  runtimeInstanceId: string;
} => {
  const apiKey = process.env.COPILOTKIT_API_KEY;
  const runtimeInstanceId = process.env.COPILOTKIT_ACP_RUNTIME_INSTANCE_ID;
  const agentId = process.env.COPILOTKIT_ACP_AGENT_ID;
  const cwd = process.env.COPILOTKIT_ACP_CWD;
  const missing = [
    !apiKey ? "COPILOTKIT_API_KEY" : undefined,
    !runtimeInstanceId ? "COPILOTKIT_ACP_RUNTIME_INSTANCE_ID" : undefined,
    !agentId ? "COPILOTKIT_ACP_AGENT_ID" : undefined,
    !cwd ? "COPILOTKIT_ACP_CWD" : undefined,
  ].filter((name): name is string => name !== undefined);

  if (!apiKey || !runtimeInstanceId || !agentId || !cwd) {
    throw new Error(`Missing ACP Showcase environment: ${missing.join(", ")}`);
  }

  return { agentId, apiKey, cwd, runtimeInstanceId };
};

/** Lists config names required before the Showcase can admit an ACP run. */
export const missingAcpEnvironment = (): string[] =>
  [
    !process.env.COPILOTKIT_API_KEY ? "COPILOTKIT_API_KEY" : undefined,
    !process.env.COPILOTKIT_ACP_RUNTIME_INSTANCE_ID
      ? "COPILOTKIT_ACP_RUNTIME_INSTANCE_ID"
      : undefined,
    !process.env.COPILOTKIT_ACP_AGENT_ID
      ? "COPILOTKIT_ACP_AGENT_ID"
      : undefined,
    !process.env.COPILOTKIT_ACP_CWD ? "COPILOTKIT_ACP_CWD" : undefined,
  ].filter((name): name is string => name !== undefined);

/** Returns the configured app-api health endpoint without exposing credentials. */
export const acpHealthUrl = (): string => {
  const apiUrl =
    process.env.COPILOTKIT_INTELLIGENCE_API_URL ||
    "https://api.intelligence.copilotkit.ai";
  return `${apiUrl.replace(/\/$/, "")}/api/health`;
};

/** Builds the AG-UI client for an external ACP relay target. */
export const createAcpRuntime = (): CopilotRuntime => {
  const {
    agentId: acpAgentId,
    apiKey,
    cwd,
    runtimeInstanceId,
  } = requiredEnvironment();
  const apiUrl = process.env.COPILOTKIT_INTELLIGENCE_API_URL;
  const wsUrl = process.env.COPILOTKIT_INTELLIGENCE_WS_URL;
  const intelligence = new CopilotKitIntelligence({
    apiKey,
    ...(apiUrl ? { apiUrl } : {}),
    ...(wsUrl ? { wsUrl } : {}),
  });
  const userId =
    process.env.COPILOTKIT_ACP_SHOWCASE_USER_ID || "showcase-acp-user";

  return new CopilotRuntime({
    identifyUser: async () => ({ id: userId, name: "ACP Showcase user" }),
    agents: Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        new AcpAgent({
          agentId: acpAgentId,
          cwd,
          intelligence,
          permissionMode: "live",
          runtimeInstanceId,
          userId,
        }),
      ]),
    ) as Record<(typeof AGENT_IDS)[number], AcpAgent>,
  });
};
