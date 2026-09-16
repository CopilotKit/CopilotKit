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
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(LEARNING_SETUP_PROMPT),
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

test("sends the coding agent to the Learning route and carries nothing else", () => {
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
  // Markdown, so one minted here would be shared by every reader.
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
