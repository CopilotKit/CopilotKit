// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroStartActions, QuickstartLinkButton } from "../hero-start-commands";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

// Read from the package root rather than `import.meta.url`: under the jsdom
// environment this module's URL is not a `file:` URL, so `readFileSync(new
// URL(...))` throws before any test runs. Vitest resolves `root` to the
// package directory, which is also this process's cwd.
const sourceFile = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), "src", relativePath), "utf8");

const heroStartCommandsSource = sourceFile(
  "components/hero-start-commands.tsx",
);
const globalsCss = sourceFile("app/globals.css");

afterEach(() => {
  cleanup();
  analytics.capture.mockReset();
});

function renderHero() {
  return render(
    <HeroStartActions
      prompt={<button data-testid="prompt-slot">Copy prompt</button>}
      quickstart={<a data-testid="quickstart-slot">Quickstart</a>}
    />,
  );
}

describe("HeroStartActions", () => {
  it("renders both hero slots", () => {
    renderHero();

    expect(screen.getByTestId("prompt-slot")).toBeTruthy();
    expect(screen.getByTestId("quickstart-slot")).toBeTruthy();
  });

  it("places the prompt slot before the quickstart slot", () => {
    renderHero();

    const prompt = screen.getByTestId("prompt-slot");
    const quickstart = screen.getByTestId("quickstart-slot");

    expect(
      prompt.compareDocumentPosition(quickstart) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the hint line as muted body text below the row", () => {
    renderHero();

    const hint = screen.getByText("Paste into Claude Code, Codex, or Cursor");

    expect(hint.tagName).toBe("P");
    expect(hint.className).toContain("text-[var(--text-muted)]");
    expect(hint.className).toContain("text-sm");
    expect(
      screen.getByTestId("quickstart-slot").compareDocumentPosition(hint) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stacks the action row on mobile and lines it up from sm up", () => {
    renderHero();

    const row = screen.getByTestId("prompt-slot").parentElement;

    expect(row?.className).toContain("flex-col");
    expect(row?.className).toContain("sm:flex-row");
    expect(row?.className).toContain("sm:items-center");
  });
});

describe("QuickstartLinkButton", () => {
  it("renders the accent primary treatment by default", () => {
    render(<QuickstartLinkButton href="/quickstart" />);

    const link = screen.getByRole("link", { name: /quickstart/i });

    expect(link.className).toContain("shell-docs-primary-cta");
    expect(link.className).toContain("bg-[var(--accent)]");
    expect(link.className).toContain("text-[var(--primary-foreground)]");
    expect(link.className).not.toContain("bg-[var(--bg-surface)]");
  });

  it("renders the bordered surface treatment for the secondary variant", () => {
    render(<QuickstartLinkButton href="/quickstart" variant="secondary" />);

    const link = screen.getByRole("link", { name: /quickstart/i });

    expect(link.className).toContain("border-[var(--border)]");
    expect(link.className).toContain("bg-[var(--bg-surface)]");
    expect(link.className).toContain("text-[var(--text)]");
    expect(link.className).toContain("hover:border-[var(--accent)]");
    expect(link.className).toContain("hover:bg-[var(--bg-elevated)]");
    expect(link.className).not.toContain("shell-docs-primary-cta");
  });

  it("keeps height, radius, shadow and focus affordances across variants", () => {
    render(
      <>
        <QuickstartLinkButton href="/primary" />
        <QuickstartLinkButton href="/secondary" variant="secondary" />
      </>,
    );

    const [primary, secondary] = screen.getAllByRole("link");

    for (const link of [primary, secondary]) {
      expect(link.className).toContain("h-11");
      expect(link.className).toContain("shell-docs-radius-control");
      expect(link.className).toContain("shadow-[var(--shadow-control)]");
    }
    expect(secondary.className).toContain("focus-visible:ring-[var(--accent)]");
  });

  it("tracks continuation into a backend-scoped quickstart", () => {
    render(
      <QuickstartLinkButton
        href="/langgraph/quickstart"
        frontend="react"
        backend="langgraph"
        fromPath="/langgraph"
        variant="secondary"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: /quickstart/i }));

    expect(analytics.capture).toHaveBeenCalledWith("docs.journey_continued", {
      destination_type: "quickstart",
      destination_path: "/langgraph/quickstart",
      frontend: "react",
      backend: "langgraph",
      from_path: "/langgraph",
    });
  });

  it("opts both variants out of prose link colors", () => {
    expect(heroStartCommandsSource).toContain("shell-docs-primary-cta");
    expect(heroStartCommandsSource).toContain("shell-docs-cta-link");
    expect(globalsCss).toContain(".reference-content a.shell-docs-primary-cta");
    expect(globalsCss).toContain("color: var(--primary-foreground);");
    expect(globalsCss).toContain(".reference-content a.shell-docs-cta-link");
  });
});
