// @vitest-environment jsdom

// Guards the compact page-tools split action.
//
// The prompt action is available even when a route has no registry-backed
// framework name; the copied context simply omits that optional sentence.
// It is tested here rather than through
// `DocsPageView` because that component reads MDX off disk, walks the content
// tree to build the sidebar, and compiles the body through `next-mdx-remote` —
// none of which the action contract depends on.

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocsPageTools, docsMarkdownUrl } from "../docs-page-tools";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/mastra/generative-ui",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const GITHUB_URL =
  "https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shell-docs/src/content/docs/generative-ui.mdx";

function renderRow(onboardingFramework?: { slug: string; name: string }): void {
  render(
    <DocsPageTools
      slugPath="generative-ui"
      slugHrefPrefix="/mastra"
      githubUrl={GITHUB_URL}
      onboardingFramework={onboardingFramework}
    />,
  );
}

it("opens page actions with a working source link", () => {
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: /more page actions/i }));
  expect(
    screen.getByRole("link", { name: /open in github/i }).getAttribute("href"),
  ).toBe(GITHUB_URL);
  expect(screen.getByRole("button", { name: /copy page/i })).toBeTruthy();
});

it("copies a prompt referring to the current page", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toContain(
    "https://docs.copilotkit.ai/mastra/generative-ui",
  );
});

it("fetches and copies page Markdown from the page actions", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const fetchMarkdown = vi
    .fn()
    .mockResolvedValue(new Response("# Page content"));
  vi.stubGlobal("fetch", fetchMarkdown);
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: /more page actions/i }));
  fireEvent.click(screen.getByRole("button", { name: /copy page/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("# Page content"));
  expect(fetchMarkdown).toHaveBeenCalledWith("/mastra/generative-ui.mdx");
});

it.each([
  [
    "/mastra",
    "generative-ui/tool-rendering",
    "/mastra/generative-ui/tool-rendering.mdx",
  ],
  ["/mastra", "", "/mastra.mdx"],
  ["", "quickstart", "/quickstart.mdx"],
])("builds the Markdown URL for %s/%s", (prefix, slug, expected) => {
  expect(docsMarkdownUrl(prefix, slug)).toBe(expected);
});
