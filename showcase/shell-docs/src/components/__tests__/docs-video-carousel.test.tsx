// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocsVideoCarousel } from "@/components/docs-video-carousel";

const TITLES = ["Shared state and Harness", "User Memories", "Rich Threads"];

const LOOM_IDS = [
  "0cad0c3d96e4454c83133a52d9ac8e7b",
  "2978fbfe42324e509057ac5fd46b7a70",
  "79817778d29e490c97225127d2f17b3a",
];

function embedUrl(id: string): string {
  return `https://www.loom.com/embed/${id}`;
}

function tabTitle(tab: HTMLElement): string | null | undefined {
  return tab.querySelector('[data-testid="tab-title"]')?.textContent;
}

afterEach(() => {
  cleanup();
});

describe("DocsVideoCarousel", () => {
  it("titles the section with the question it answers", () => {
    render(<DocsVideoCarousel />);

    expect(() =>
      screen.getByRole("heading", { name: "What is CopilotKit?" }),
    ).not.toThrow();
  });

  it("renders all three tabs, in the documented order, with their titles", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tabTitle(tab))).toEqual(TITLES);
  });

  // The summary describes the selected recording and changes with the tab,
  // so it belongs to the panel rather than sitting beside the tab strip.
  // Outside the panel it is orphaned for anyone who navigates by landmark
  // or moves straight into the panel from its tab.
  it("puts the selected recording's summary inside the tab panel, with the video", () => {
    render(<DocsVideoCarousel />);

    const panel = screen.getByRole("tabpanel");
    const iframe = panel.querySelector("iframe");
    expect(iframe).not.toBeNull();

    const summary = panel.querySelector("p");
    expect(summary).not.toBeNull();
    expect(summary!.textContent!.trim().length).toBeGreaterThan(20);

    // And it is the *selected* one's summary: switching tabs changes it.
    const before = summary!.textContent;
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    const after = screen.getByRole("tabpanel").querySelector("p")!.textContent;
    expect(after).not.toBe(before);
  });

  it("selects exactly one tab, the first, initially", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    const selected = tabs.filter(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(tabs[0]);
  });

  it("mounts exactly one iframe, with the selected recording's full embed URL", () => {
    render(<DocsVideoCarousel />);

    const iframes = document.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0].getAttribute("src")).toBe(embedUrl(LOOM_IDS[0]));
  });

  it("swaps the iframe src and moves aria-selected when another tab is clicked", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[2]);

    const reselected = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(reselected).toHaveLength(1);
    expect(tabTitle(reselected[0])).toBe("Rich Threads");

    const iframes = document.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0].getAttribute("src")).toBe(embedUrl(LOOM_IDS[2]));
  });

  it("moves the selection with ArrowRight and ArrowLeft", () => {
    render(<DocsVideoCarousel />);

    const firstTab = screen.getAllByRole("tab")[0];
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "ArrowLeft" });
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("wraps ArrowLeft from the first tab to the last", () => {
    render(<DocsVideoCarousel />);

    const firstTab = screen.getAllByRole("tab")[0];
    fireEvent.keyDown(firstTab, { key: "ArrowLeft" });

    const tabs = screen.getAllByRole("tab");
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the first tab on Home and the last tab on End", () => {
    render(<DocsVideoCarousel />);

    const firstTab = screen.getAllByRole("tab")[0];
    fireEvent.keyDown(firstTab, { key: "End" });
    expect(screen.getAllByRole("tab")[2].getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(screen.getAllByRole("tab")[2], { key: "Home" });
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("keeps only the active tab in the tab order", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    const inTabOrder = tabs.filter((tab) => tab.tabIndex === 0);
    expect(inTabOrder).toHaveLength(1);
    expect(inTabOrder[0]).toBe(tabs[0]);

    fireEvent.click(tabs[1]);

    const afterClick = screen.getAllByRole("tab");
    expect(afterClick.filter((tab) => tab.tabIndex === 0)).toEqual([
      afterClick[1],
    ]);
  });

  it("gives every iframe a non-empty title", () => {
    render(<DocsVideoCarousel />);

    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      const iframe = document.querySelector("iframe");
      expect(iframe?.getAttribute("title")).toBeTruthy();
    }
  });

  // The two CopilotKit Intelligence recordings carry the product's kite
  // mark; the open-source shared-state one does not. Asserted on what
  // actually renders, not by reading the recordings array back.
  it("marks exactly the two Intelligence recordings, and only those, as Intelligence", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    const marked = tabs.filter((tab) =>
      tab.textContent?.includes("Intelligence"),
    );
    expect(marked).toHaveLength(2);

    expect(tabs[0].textContent).not.toContain("Intelligence");
    expect(tabs[1].textContent).toContain("Intelligence");
    expect(tabs[2].textContent).toContain("Intelligence");
  });

  // The kite mark is `aria-hidden`, so a screen reader only learns what it
  // means if the word itself is real, visible text next to it, not merely
  // implied by an icon.
  it("carries the Intelligence mark's meaning to assistive technology as text, not only as an icon", () => {
    render(<DocsVideoCarousel />);

    const markedTab = screen.getAllByRole("tab")[1];
    const icon = markedTab.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(markedTab.textContent).toContain("Intelligence");
  });

  // The section-level chrome centres to match the rest of the homepage
  // below the hero; the tabs' own behaviour (selection, keyboard, the
  // Intelligence mark) is covered separately above and untouched by this.
  it("centres the section heading, the tab strip, and the caption", () => {
    render(<DocsVideoCarousel />);

    const heading = screen.getByRole("heading", {
      name: "What is CopilotKit?",
    });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    expect(section!.className).toContain("text-center");

    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("justify-center");

    const panel = screen.getByRole("tabpanel");
    const caption = panel.querySelector("p");
    expect(caption).not.toBeNull();
    // The caption has no centring class of its own — it inherits the
    // section's text-center, so walk up to confirm that ancestor exists
    // rather than asserting on computed style, which jsdom never lays out.
    let ancestor: HTMLElement | null = caption;
    while (ancestor && !ancestor.className.includes("text-center")) {
      ancestor = ancestor.parentElement;
    }
    expect(ancestor).not.toBeNull();
  });

  it("never renders an em-dash", () => {
    const { container } = render(<DocsVideoCarousel />);

    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      expect(container.innerHTML).not.toContain("—");
    }
  });
});
