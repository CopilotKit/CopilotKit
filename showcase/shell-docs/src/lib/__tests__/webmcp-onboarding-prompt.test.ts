import { expect, test } from "vitest";
import { createWebMCPOnboardingPrompt } from "../webmcp-onboarding-prompt";

test("keeps WebMCP as the goal of the CLI onboarding run", () => {
  const prompt = createWebMCPOnboardingPrompt("0123456789ab");

  expect(prompt)
    .toBe(`Identify which coding-agent product you are, using a short slug such as \`codex\` or \`claude-code\`. From the root of the project where you want CopilotKit, run \`npx --yes copilotkit@latest onboard start --run 0123456789ab --coding-agent <coding-agent-slug>\`. Follow the Markdown instructions it prints until onboarding is complete.

The goal of this onboarding run is to get WebMCP working in this project. Use https://docs.copilotkit.ai/webmcp as the official guide. Let the onboarding workflow inspect the repository and determine whether the app already has CopilotKit, a backend agent, CopilotKit frontend tools, or only browser-side actions. Ask only about choices the repository cannot answer.

A WebMCP call does not require a CopilotKit backend agent. If suitable CopilotKit frontend tools already exist, expose only the appropriate ones through WebMCP. Otherwise, wrap the smallest suitable browser-side action in a supported CopilotKit frontend tool. Do not create or replace a backend agent solely for WebMCP.

Preserve the existing framework, agent behavior, authentication, authorization, and user-confirmation boundaries. Follow the guide for schemas, annotations, browser requirements, and verification. Finish only after a compatible browser can discover and call the intended tool; if the selected surface cannot provide \`document.modelContext\`, explain that limitation instead of adding a fake integration.`);
});
