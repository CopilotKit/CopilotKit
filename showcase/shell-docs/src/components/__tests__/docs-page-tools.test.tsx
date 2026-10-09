// @vitest-environment jsdom

// Guards the compact page-tools split action.
//
// The prompt action is available even when a route has no registry-backed
// framework name; the copied context simply omits that optional sentence.
// It is tested here rather than through
// `DocsPageView` because that component reads MDX off disk, walks the content
// tree to build the sidebar, and compiles the body through `next-mdx-remote` —
// none of which the action contract depends on.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

it("names the page the markdown button fetches, without its .mdx suffix", async () => {
  // The row computes the URL once and hands it to both buttons, so the page
  // the prompt names and the text "Copy Markdown" fetches cannot drift apart.
  // The prompt names the human page, not the `.mdx` text (PE-309).
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  renderRow({ slug: "mastra", name: "Mastra" });
  fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  expect(writeText.mock.calls[0][0]).toContain(
    "https://docs.copilotkit.ai/mastra/generative-ui.",
  );
});

describe("docsMarkdownUrl", () => {
  it("appends .mdx to the page's own URL", () => {
    expect(docsMarkdownUrl("/mastra", "generative-ui/tool-rendering")).toBe(
      "/mastra/generative-ui/tool-rendering.mdx",
    );
  });

  it("collapses the empty slug of a framework root", () => {
    // `slugPath` is "" at `/<framework>`, which would otherwise produce a
    // trailing-slash URL the `.mdx` rewrite does not match.
    expect(docsMarkdownUrl("/mastra", "")).toBe("/mastra.mdx");
  });

  it("keeps a root-surface page at the origin", () => {
    expect(docsMarkdownUrl("", "quickstart")).toBe("/quickstart.mdx");
  });
});

// A page with its own `agentPrompt` hands the agent that task instead of the
// generic onboarding prompt, and still names the page it came from.
it("copies the page's own prompt when the page supplies one", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <DocsPageTools
      slugPath="manufact"
      slugHrefPrefix="/cookbook"
      githubUrl={GITHUB_URL}
      onboardingFramework={{ slug: "built-in-agent", name: "Built-in" }}
      pagePrompt="Add an mcp-use MCP App to my CopilotKit app."
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toBe(
    "Add an mcp-use MCP App to my CopilotKit app. I started from this CopilotKit docs page: https://docs.copilotkit.ai/cookbook/manufact.",
  );
});
