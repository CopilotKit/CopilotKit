// @vitest-environment jsdom

// Behavioural tests for the curated Intelligence recommendation in the
// docs search modal. Everything is driven through the real modal — real
// input, real keyboard events, real click handlers — so these stay true
// across restyling and copy edits. Only the ambient wiring (router,
// framework provider, runtime config, PostHog) is faked.
//
// The keyword table and matcher have their own tests in
// lib/__tests__/intelligence-search-ctas.test.ts.

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushed: string[] = [];
const captured: Array<{ event: string; props: Record<string, unknown> }> = [];
let postHogThrows = false;

vi.mock("posthog-js", () => ({
  default: {
    capture: (event: string, props: Record<string, unknown>) => {
      if (postHogThrows) throw new Error("blocked by an ad blocker");
      captured.push({ event, props });
    },
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/quickstart",
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
  }),
}));

vi.mock("../framework-provider", () => ({
  DEFAULT_FRAMEWORK: "built-in-agent",
  useFramework: () => ({
    effectiveFramework: "built-in-agent",
    knownFrameworks: [],
    setStoredFramework: () => {},
  }),
}));

import { SearchModal } from "../search-modal";

function resultRows(): HTMLElement[] {
  if (!screen.queryByRole("listbox", { name: "Search results" })) return [];
  return screen.getAllByRole("option");
}

/**
 * Indexes of the result rows whose trailing arrow is drawn in the accent
 * colour — i.e. the rows the UI claims are selected.
 */
function accentedArrowRowIndexes(rows: HTMLElement[]): number[] {
  return rows.flatMap((row, idx) => {
    const arrow = row.querySelector("svg.lucide-arrow-right");
    return arrow?.getAttribute("class")?.includes("text-[var(--accent)]")
      ? [idx]
      : [];
  });
}

function recommendation(): HTMLElement | null {
  return screen.queryByRole("group", { name: "Recommended guide" });
}

function recommendationLinks(): HTMLAnchorElement[] {
  const block = recommendation();
  if (!block) return [];
  return Array.from(block.querySelectorAll("a[href]"));
}

function primaryLink(): HTMLElement {
  return screen.getByRole("link", { name: /^Recommended:/ });
}

async function search(query: string): Promise<void> {
  render(<SearchModal onClose={() => {}} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Choose docs framework/ }).textContent,
    ).not.toContain("Loading frameworks"),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  await waitFor(() =>
    expect(resultRows().length + (recommendation() ? 1 : 0)).toBeGreaterThan(0),
  );
}

beforeEach(() => {
  pushed.length = 0;
  captured.length = 0;
  postHogThrows = false;
  window.__SHOWCASE_CONFIG__ = {
    baseUrl: "https://docs.copilotkit.test/",
    shellUrl: "https://showcase.copilotkit.test",
    intelligenceSignupUrl: "https://ops.copilotkit.test/",
    posthogKey: "",
    posthogHost: "https://posthog.test/",
    scarfPixelId: "",
    googleAnalyticsTrackingId: "",
    reb2bKey: "",
    reoKey: "",
    clerkPublishableKey: "",
  };
});

afterEach(() => {
  cleanup();
  delete window.__SHOWCASE_CONFIG__;
});

describe("when the recommendation appears", () => {
  it("shows exactly one block for a keyword query", async () => {
    await search("threads");

    expect(
      screen.getAllByRole("group", { name: "Recommended guide" }),
    ).toHaveLength(1);
    expect(recommendation()!.textContent).toContain(
      "Threads that survive a reload",
    );
  });

  it("shows the most specific block, never two", async () => {
    await search("intelligence threads");

    const blocks = screen.getAllByRole("group", { name: "Recommended guide" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toContain("Threads that survive a reload");
    expect(blocks[0].textContent).not.toContain(
      "Persistent threads, analytics",
    );
  });

  it("stays away from unrelated queries", async () => {
    for (const query of ["useCopilotAction", "angular quickstart", "css"]) {
      await search(query);
      expect(recommendation()).toBeNull();
      cleanup();
    }
  });

  it("adds to the result list instead of replacing part of it", async () => {
    await search("threads");

    const block = recommendation()!;
    const list = screen.getByRole("listbox", { name: "Search results" });
    // The block renders above the organic results...
    expect(
      block.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ...and costs none of the twelve result slots.
    expect(resultRows()).toHaveLength(12);
  });
});

describe("how the recommendation is announced", () => {
  it("is a labelled group, not another row in the results listbox", async () => {
    await search("threads");

    const block = recommendation()!;
    expect(block.getAttribute("role")).toBe("group");
    expect(
      screen.getAllByRole("option").every((option) => !block.contains(option)),
    ).toBe(true);
  });

  it("names itself a recommendation on the link the keyboard lands on", async () => {
    await search("threads");

    expect(primaryLink().getAttribute("aria-label")).toContain("Recommended:");
    expect(
      screen.getByRole("combobox").getAttribute("aria-controls"),
    ).toContain(recommendation()!.id);
  });
});

describe("keyboard and pointer selection", () => {
  it("puts the block first, ahead of the results", async () => {
    await search("threads");

    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-activedescendant")).toBe(primaryLink().id);
    expect(resultRows()[0].getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(resultRows()[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).not.toBe(
      primaryLink().id,
    );

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(primaryLink().id);
    expect(resultRows()[0].getAttribute("aria-selected")).toBe("false");
  });

  it("lights the arrow on the selected row, not the one below it", async () => {
    await search("threads");

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const rows = resultRows();
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    // The accented arrow must sit on exactly the row that is selected.
    // Before the fix the arrow compared the row index against a selection
    // that counts the recommendation block, so it lit row 2 instead.
    expect(accentedArrowRowIndexes(rows)).toEqual([1]);
  });

  it("keeps hover in sync exactly as result rows do", async () => {
    await search("threads");

    const input = screen.getByRole("combobox");
    fireEvent.mouseEnter(resultRows()[2]);
    expect(resultRows()[2].getAttribute("aria-selected")).toBe("true");

    fireEvent.mouseEnter(recommendation()!);
    expect(resultRows()[2].getAttribute("aria-selected")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBe(primaryLink().id);
  });

  it("activates the block on Enter", async () => {
    await search("threads");

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(pushed).toHaveLength(1);
    expect(pushed[0].startsWith("/threads?")).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe("docs_conversion_clicked");
    expect(captured[0].props.surface).toBe("docs-search:threads:threads");
  });

  it("activates a result on Enter once the selection has moved off the block", async () => {
    await search("threads");

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).not.toContain("utm_source");
    expect(captured).toHaveLength(0);
  });
});

describe("the whole block is one clickable card", () => {
  it("activates the primary destination from a click on the card body", async () => {
    await search("self-hosting");

    // The card-wide hit area belongs to the primary anchor's overlay, so a
    // reader clicking the block's heading text lands on the primary page.
    fireEvent.click(primaryLink());

    expect(pushed).toHaveLength(1);
    expect(pushed[0].startsWith("/intelligence/self-hosting?")).toBe(true);
  });

  it("sends a secondary link to its own destination, not the primary one", async () => {
    await search("self-hosting");

    const secondary = screen.getByRole("link", {
      name: "Platform architecture",
    });
    fireEvent.click(secondary);

    expect(pushed).toHaveLength(1);
    expect(pushed[0].startsWith("/intelligence/intelligence-platform?")).toBe(
      true,
    );
    expect(pushed[0]).not.toContain("/self-hosting");
    // Stacked above the card overlay so its own click wins.
    expect(secondary.closest("div")?.className).toContain("z-10");
  });

  it("keeps the primary action openable in a new tab", async () => {
    await search("threads");

    const primary = primaryLink() as HTMLAnchorElement;
    // A real anchor with a real href: focusable, middle-clickable, and
    // "open in new tab" lands on the same attributed URL a click would.
    expect(primary.tagName).toBe("A");
    expect(primary.getAttribute("href")).toContain("/threads?");
    expect(primary.getAttribute("href")).toContain(
      "utm_content=docs-search%3Athreads%3Athreads",
    );

    // A cmd-click is the browser's to handle — we must not swallow it.
    fireEvent.click(primary, { metaKey: true });
    expect(pushed).toHaveLength(0);
    // ...but it is still reported.
    expect(captured).toHaveLength(1);
    expect(captured[0].props.surface).toBe("docs-search:threads:threads");
  });

  it("attributes every link with the surface and matched keyword", async () => {
    await search("persistence");

    for (const link of recommendationLinks()) {
      expect(link.getAttribute("href")).toContain(
        "utm_content=docs-search%3Athreads%3Apersistence",
      );
    }

    fireEvent.click(recommendationLinks()[1]);
    expect(captured).toHaveLength(1);
    expect(captured[0].props.surface).toBe("docs-search:threads:persistence");
    expect(captured[0].props.matched_keyword).toBe("persistence");
  });
});

describe("navigation and attribution", () => {
  it("routes the primary link through the modal's own router", async () => {
    await search("self-hosting");

    fireEvent.click(primaryLink());

    expect(pushed).toHaveLength(1);
    expect(pushed[0].startsWith("/intelligence/self-hosting?")).toBe(true);
  });

  it("routes a secondary link the same way", async () => {
    await search("self-hosting");

    fireEvent.click(
      screen.getByRole("link", { name: "Platform architecture" }),
    );

    expect(pushed).toHaveLength(1);
    expect(pushed[0].startsWith("/intelligence/intelligence-platform?")).toBe(
      true,
    );
  });

  it("keeps every destination an internal docs route", async () => {
    await search("intelligence");

    const count = recommendationLinks().length;
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i += 1) {
      fireEvent.click(recommendationLinks()[i]);
    }

    expect(pushed).toHaveLength(count);
    for (const href of pushed) {
      expect(href.startsWith("/")).toBe(true);
      expect(href).not.toMatch(/^(https?:)?\/\//);
      // The placeholder origin used to run internal paths through the
      // shared attribution helper must never leak into the href.
      expect(href).not.toContain("invalid");
    }
  });

  it("reports the keyword that fired rather than the raw query", async () => {
    await search("persistence");

    fireEvent.click(primaryLink());

    expect(captured[0].props.matched_keyword).toBe("persistence");
    expect(captured[0].props.cta_id).toBe("threads");
    expect(captured[0].props.surface).toBe("docs-search:threads:persistence");
  });

  it("still navigates when analytics is blocked", async () => {
    await search("threads");
    postHogThrows = true;

    fireEvent.click(primaryLink());

    expect(pushed).toHaveLength(1);
    expect(pushed[0].startsWith("/threads?")).toBe(true);
  });
});
