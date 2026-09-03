import {
  createIntelligenceOnboardingPrompt,
  INTELLIGENCE_ONBOARDING_PROMPT,
} from "./intelligence-onboarding-prompt";

export const WEBMCP_DOCS_URL = "https://docs.copilotkit.ai/webmcp";

/** Build the WebMCP goal that a docs reader hands to the CLI onboarding flow. */
export function createWebMCPOnboardingPrompt(runId?: string): string {
  const onboardingPrompt = runId
    ? createIntelligenceOnboardingPrompt(runId)
    : INTELLIGENCE_ONBOARDING_PROMPT.replace(" --run <run-id>", "");

  return `${onboardingPrompt}

The goal of this onboarding run is to get WebMCP working in this project. Use ${WEBMCP_DOCS_URL} as the official guide. Let the onboarding workflow inspect the repository and determine whether the app already has CopilotKit, a backend agent, CopilotKit frontend tools, or only browser-side actions. Ask only about choices the repository cannot answer.

A WebMCP call does not require a CopilotKit backend agent. If suitable CopilotKit frontend tools already exist, expose only the appropriate ones through WebMCP. Otherwise, wrap the smallest suitable browser-side action in a supported CopilotKit frontend tool. Do not create or replace a backend agent solely for WebMCP.

Preserve the existing framework, agent behavior, authentication, authorization, and user-confirmation boundaries. Follow the guide for schemas, annotations, browser requirements, and verification. Finish only after a compatible browser can discover and call the intended tool; if the selected surface cannot provide \`document.modelContext\`, explain that limitation instead of adding a fake integration.`;
}
