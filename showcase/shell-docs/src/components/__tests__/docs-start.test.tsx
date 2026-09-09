import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DocsStart } from "../docs-start";

// `DocsStart` itself is a server component, but both of its actions are
// client components: the prompt button reads `usePathname`/`usePostHog`, and
// the quickstart link reads `usePostHog` and renders `next/link`. Stubbing
// those three modules is enough to render the real buttons statically, which
// matters — the one-primary-action assertion below counts the CTA treatment
// on the REAL buttons, so mocking either button away would defeat it.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Count non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("DocsStart", () => {
  it("anchors the section at the id the hero's path links point at", () => {
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(markup).toContain('id="start"');
    // Not MDX prose: the prose typography must not repaint this section.
    expect(markup).toContain("not-prose");
  });

  it("names the three starting paths as one reassurance line", () => {
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(markup).toContain(
      "Works whether you are starting from nothing · already have an app or an agent · or already run CopilotKit and want to add Intelligence.",
    );
  });

  it("explains what the copied prompt runs, with the command as inline code", () => {
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(markup).toContain("Copy one prompt. Your coding agent runs");
    expect(markup).toContain("<code");
    expect(markup).toContain("copilotkit onboard");
    expect(markup).toContain(
      "which works out where you already are and takes the shortest path from there.",
    );
  });

  it("offers exactly ONE primary action", () => {
    // The load-bearing test of this component. `copilotkit onboard`
    // classifies the starting state itself, so three per-path buttons would
    // copy one identical prompt and stage a choice that does not exist. If a
    // later change reintroduces competing primary buttons — one per path —
    // this count catches it.
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(countOccurrences(markup, "shell-docs-primary-cta")).toBe(1);
    // And that single primary is the canonical onboarding prompt button,
    // reported under a `docs_landing_*` surface.
    expect(countOccurrences(markup, 'data-surface="docs_landing_start"')).toBe(
      1,
    );
    expect(markup).toContain("Copy onboarding prompt");
  });

  it("keeps manual setup as a quiet secondary link to /quickstart", () => {
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(markup).toContain('href="/quickstart"');
    expect(markup).toContain("Set it up manually");
    // The hero's secondary treatment, not a second accent button.
    expect(countOccurrences(markup, "shell-docs-cta-link")).toBe(1);
  });

  it("stacks the two actions vertically on narrow viewports", () => {
    // No horizontal scrolling at 375px: the row is a column below `sm`, and
    // both buttons are full width there.
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(markup).toContain("flex-col");
    expect(markup).toContain("sm:flex-row");
    expect(countOccurrences(markup, "w-full")).toBe(2);
    expect(countOccurrences(markup, "sm:w-fit")).toBe(2);
  });

  it("paints from design tokens only, with no hard-coded colour", () => {
    const markup = renderToStaticMarkup(<DocsStart />);

    expect(markup).toContain("var(--text)");
    expect(markup).not.toMatch(/#(?:[0-9a-fA-F]{3,4}){1,2}(?![0-9a-fA-F])/);
    expect(markup).not.toMatch(/\b(?:rgb|hsl)a?\(/);
  });
});
