// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  LEARNING_SETUP_PROMPT,
  LearningSetupPrompt,
} from "../learning-setup-prompt";

afterEach(() => {
  cleanup();
});

test("configures the shared coding-agent prompt card for Automatic Learning", async () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  try {
    render(<LearningSetupPrompt />);

    const region = screen.getByRole("region", {
      name: "Use this pre-built prompt to set up Automatic Learning faster.",
    });
    expect(region.getAttribute("data-docs-copy-surface")).toBe(
      "docs_learning_setup_prompt",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    // The card mints a run id, so it copies the link form rather than the
    // static constant -- that constant is the raw-Markdown shape and has no
    // run to point at. The two differing here is the point, not a drift.
    await waitFor(() =>
      expect(writeText.mock.calls[0]?.[0]).toMatch(
        /^Read https:\/\/copilotkit\.ai\/onboarding-prompts\/[a-f0-9]{12}\?intent=add-learning and help me set this up\.$/,
      ),
    );
    expect(screen.getByRole("status").textContent).toBe("Prompt copied");
    expect(screen.getByRole("button", { name: "Open in Codex" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "More page actions" }),
    ).toBeTruthy();
  } finally {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  }
});

test("sends the coding agent to the Automatic Learning route and carries nothing else", () => {
  // The route owns the guide link, the container-selection rules and the
  // `getLearningContainerId` wiring this prompt used to repeat. That copy had
  // already drifted from the shipped API once; OSS-1150 retired it.
  expect(LEARNING_SETUP_PROMPT).toContain(
    "npx --yes copilotkit@latest onboard start --intent add-learning",
  );
  expect(LEARNING_SETUP_PROMPT).not.toContain("docs.copilotkit.ai");
  expect(LEARNING_SETUP_PROMPT).not.toContain("getLearningContainerId");
  expect(LEARNING_SETUP_PROMPT).not.toContain("container");
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

test("keeps credential protection without the diagnostic feedback restriction", () => {
  expect(LEARNING_SETUP_PROMPT).toContain("Never reveal credentials.");
  expect(LEARNING_SETUP_PROMPT).not.toContain("diagnostic");
});
