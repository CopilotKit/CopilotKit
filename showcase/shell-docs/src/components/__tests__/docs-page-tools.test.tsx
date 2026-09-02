// @vitest-environment jsdom

// Guards the narrowed coverage of the page-tools "Copy agent prompt" button.
//
// The rule is that the button appears only on framework-scoped docs pages, and
// `DocsPageTools` is where that rule lives: no `onboardingFramework`, no
// button. It is tested here rather than through `DocsPageView` because that
// component reads MDX off disk, walks the content tree to build the sidebar,
// and compiles the body through `next-mdx-remote` — none of which the rule
// depends on. `DocsPageView` does nothing with the prop but forward it, so
// this is the seam where a regression would actually show up.

import React from "react";
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

it("renders no onboarding button when no framework is passed", () => {
  // What the cookbook routes and the frameworkless root-surface pages
  // (`/faq`, `/examples`) get: they share `DocsPageView` with the framework
  // route and opt out by simply not passing the prop. If the button ever
  // became unconditional again, this fails.
  renderRow();

  expect(screen.queryByRole("button", { name: /copy agent prompt/i })).toBe(
    null,
  );
  // The rest of the row is untouched — narrowing the onboarding button must
  // not take the markdown affordances with it.
  expect(screen.getByRole("button", { name: /copy markdown/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^open$/i })).toBeTruthy();
});

it("renders the onboarding button when a framework is passed", () => {
  renderRow({ slug: "mastra", name: "Mastra" });

  expect(
    screen.getByRole("button", { name: /copy agent prompt/i }),
  ).toBeTruthy();
});

it("gives the onboarding button the same .mdx URL as the markdown button", async () => {
  // The row computes the URL once and hands it to both buttons, so the URL the
  // prompt names and the URL "Copy Markdown" fetches cannot drift apart.
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  renderRow({ slug: "mastra", name: "Mastra" });
  fireEvent.click(screen.getByRole("button", { name: /copy agent prompt/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  expect(writeText.mock.calls[0][0]).toContain(
    "https://docs.copilotkit.ai/mastra/generative-ui.mdx",
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
