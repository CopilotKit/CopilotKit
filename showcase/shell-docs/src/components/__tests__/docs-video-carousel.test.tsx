// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocsVideoCarousel } from "@/components/docs-video-carousel";

const TITLES = [
  "Shared state and Harness",
  "Learning and memory",
  "Rich threads",
];

const LOOM_IDS = [
  "0cad0c3d96e4454c83133a52d9ac8e7b",
  "2978fbfe42324e509057ac5fd46b7a70",
  "79817778d29e490c97225127d2f17b3a",
];

function embedUrl(id: string): string {
  return `https://www.loom.com/embed/${id}`;
}

afterEach(() => {
  cleanup();
});

describe("DocsVideoCarousel", () => {
  it("renders all three tabs, in the documented order, with their titles", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.textContent)).toEqual(TITLES);
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
    expect(reselected[0].textContent).toBe("Rich threads");

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
});
