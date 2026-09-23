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
import { WEBMCP_SETUP_PROMPT, WebMCPSetupPrompt } from "../webmcp-setup-prompt";

afterEach(() => {
  cleanup();
});

test("configures the shared coding-agent prompt card for WebMCP", async () => {
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
    render(<WebMCPSetupPrompt />);

    const region = screen.getByRole("region", {
      name: "Use this pre-built prompt to get WebMCP running faster.",
    });
    expect(region.getAttribute("data-docs-copy-surface")).toBe(
      "docs_webmcp_setup_prompt",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(WEBMCP_SETUP_PROMPT),
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

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));
