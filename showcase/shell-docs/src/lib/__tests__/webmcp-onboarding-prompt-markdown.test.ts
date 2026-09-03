import { expect, test } from "vitest";
import { createWebMCPOnboardingPrompt } from "../webmcp-onboarding-prompt";

test("keeps the Markdown prompt usable when no telemetry run id is available", () => {
  const prompt = createWebMCPOnboardingPrompt();

  expect(prompt).toContain(
    "npx --yes copilotkit@latest onboard start --coding-agent <coding-agent-slug>",
  );
  expect(prompt).not.toContain("--run undefined");
  expect(prompt).not.toContain("<run-id>");
});
