// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyHint } from "@/components/api-key-hint";
import { docsComponents } from "@/lib/mdx-registry";

describe("ApiKeyHint", () => {
  afterEach(() => {
    cleanup();
  });

  it("links out to the provider's key page in a new tab", () => {
    render(<ApiKeyHint provider="openai" />);

    const link = screen.getByRole("link", { name: /OpenAI API key/ });
    expect(link.getAttribute("href")).toBe(
      "https://platform.openai.com/api-keys",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each([
    ["anthropic", "https://console.anthropic.com/"],
    ["google", "https://aistudio.google.com/apikey"],
    ["langsmith", "https://smith.langchain.com/"],
    ["copilotkit", "https://dashboard.operations.copilotkit.ai/"],
  ])("resolves the %s provider", (provider, url) => {
    const { container } = render(<ApiKeyHint provider={provider} />);

    expect(container.querySelector("a")?.getAttribute("href")).toBe(url);
  });

  it("renders nothing for an unknown provider", () => {
    const { container } = render(<ApiKeyHint provider="not-a-provider" />);

    expect(container.innerHTML).toBe("");
  });

  // MDX pages call `<ApiKeyHint />` by name, so an unregistered component
  // fails at page-render time rather than at build time.
  it("is registered as an MDX component", () => {
    expect(docsComponents.ApiKeyHint).toBe(ApiKeyHint);
  });
});
