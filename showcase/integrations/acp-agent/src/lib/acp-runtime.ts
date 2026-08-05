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
  apiKey: string;
  profileId: string;
} => {
  const apiKey = process.env.COPILOTKIT_API_KEY;
  const profileId = process.env.COPILOTKIT_ACP_AGENT_PROFILE_ID;
  const missing = [
    !apiKey ? "COPILOTKIT_API_KEY" : undefined,
    !profileId ? "COPILOTKIT_ACP_AGENT_PROFILE_ID" : undefined,
  ].filter((name): name is string => name !== undefined);

  if (!apiKey || !profileId) {
    throw new Error(`Missing ACP Showcase environment: ${missing.join(", ")}`);
  }

  return { apiKey, profileId };
};

/** Lists config names required before the Showcase can admit an ACP run. */
export const missingAcpEnvironment = (): string[] =>
  [
    !process.env.COPILOTKIT_API_KEY ? "COPILOTKIT_API_KEY" : undefined,
    !process.env.COPILOTKIT_ACP_AGENT_PROFILE_ID
      ? "COPILOTKIT_ACP_AGENT_PROFILE_ID"
      : undefined,
  ].filter((name): name is string => name !== undefined);

/** Returns the configured app-api health endpoint without exposing credentials. */
export const acpHealthUrl = (): string => {
  const apiUrl =
    process.env.COPILOTKIT_INTELLIGENCE_API_URL ||
    "https://api.intelligence.copilotkit.ai";
  return `${apiUrl.replace(/\/$/, "")}/api/health`;
};

/** Builds the thin AG-UI runtime facade over the durable Intelligence ACP service. */
export const createAcpRuntime = (): CopilotRuntime => {
  const { apiKey, profileId } = requiredEnvironment();
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
    agents: Object.fromEntries(
      AGENT_IDS.map((agentId) => [
        agentId,
        new AcpAgent({
          agentProfileId: profileId,
          intelligence,
          userId,
        }),
      ]),
    ) as Record<(typeof AGENT_IDS)[number], AcpAgent>,
  });
};
