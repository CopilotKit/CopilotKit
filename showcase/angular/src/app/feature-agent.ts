import type { ActivatedRoute } from "@angular/router";
import { integrationId } from "./runtime-context";

const AGENT_BY_FEATURE: Readonly<Record<string, string>> = {
  "agent-config": "agent-config-demo",
  "agentic-chat": "agentic_chat",
  auth: "auth-demo",
  "frontend-tools": "frontend_tools",
  multimodal: "multimodal-demo",
  voice: "voice-demo",
};

const BUILT_IN_AGENT_OVERRIDES: Readonly<Record<string, string>> = {
  "reasoning-custom": "agentic-chat-reasoning",
  "reasoning-default": "reasoning-default-render",
  "tool-rendering-reasoning-chain": "tool-rendering-reasoning-chain",
};

const INTEGRATION_AGENT_OVERRIDES: Readonly<Record<string, string>> = {
  "llamaindex/reasoning-custom": "agentic-chat-reasoning",
  "llamaindex/reasoning-default": "reasoning-default-render",
  "pydantic-ai/frontend-tools": "frontend-tools",
};

const THREAD_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "threadid-frontend-tool-roundtrip": "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
};

/** Resolve the backend agent used by an exact shared integration contract. */
export function agentIdForFeature(
  feature: string,
  integration: string,
): string {
  if (integration === "built-in-agent") {
    return BUILT_IN_AGENT_OVERRIDES[feature] ?? "default";
  }
  const integrationOverride =
    INTEGRATION_AGENT_OVERRIDES[`${integration}/${feature}`];
  if (integrationOverride) {
    return integrationOverride;
  }
  return AGENT_BY_FEATURE[feature] ?? feature;
}

/** Resolve the generated agent identifier for an activated Showcase route. */
export function agentIdForRoute(
  feature: string,
  _route: ActivatedRoute,
): string {
  return agentIdForFeature(feature, integrationId());
}

/** Resolve an explicit thread required by a feature-level regression contract. */
export function threadIdForFeature(feature: string): string | undefined {
  return THREAD_ID_OVERRIDES[feature];
}
