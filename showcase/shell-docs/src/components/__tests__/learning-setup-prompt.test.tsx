// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LEARNING_SETUP_PROMPT } from "../learning-setup-prompt";

afterEach(() => {
  cleanup();
});

test("sends the coding agent to the Automatic Learning route and carries nothing else", () => {
  // The route owns the guide link, the container-selection rules and the
  // `getLearningContainerId` wiring this prompt used to repeat. That copy had
  // already drifted from the shipped API once; OSS-1150 retired it.
  expect(LEARNING_SETUP_PROMPT).toContain(
    "npx --yes copilotkit@latest onboard start --intent add-learning",
  );
  // No run id: this string is static and llm-text inlines it into cached raw
  // Markdown, so one minted here would be shared by every reader. That is also
  // why it keeps the command rather than a link -- a run-id-less URL could be
  // counted but never joined (PE-224).
  expect(LEARNING_SETUP_PROMPT).not.toContain("--run");
});

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));
