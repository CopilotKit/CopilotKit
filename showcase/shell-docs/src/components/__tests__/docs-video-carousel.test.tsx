// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocsVideoCarousel } from "@/components/docs-video-carousel";

const TITLES = ["Shared state", "User Memories", "Rich Threads"];

const LOOM_IDS = [
  "0cad0c3d96e4454c83133a52d9ac8e7b",
  "2978fbfe42324e509057ac5fd46b7a70",
  "79817778d29e490c97225127d2f17b3a",
];

function embedUrl(id: string): string {
  return `https://www.loom.com/embed/${id}?autoplay=1`;
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
      screen.getByRole("heading", { name: "See it in action" }),
    ).not.toThrow();
  });

  it("renders all three tabs, in the documented order, with their titles", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tabTitle(tab))).toEqual(TITLES);
  });

  it("explains the selected outcome before playback", () => {
    render(<DocsVideoCarousel />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("flag transactions");
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getByRole("tabpanel").textContent).toContain(
      "across conversations",
    );
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

  it("loads the player only after an explicit play action", () => {
    render(<DocsVideoCarousel />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toContain(
      "cdn.loom.com",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Play Shared state walkthrough" }),
    );

    const iframes = document.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0].getAttribute("src")).toBe(embedUrl(LOOM_IDS[0]));
  });

  it("swaps the iframe src and moves aria-selected when another tab is clicked", () => {
    render(<DocsVideoCarousel />);

    fireEvent.click(
      screen.getByRole("button", { name: "Play Shared state walkthrough" }),
    );
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[2]);
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Play Rich Threads walkthrough" }),
    );

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
      fireEvent.click(screen.getByRole("button", { name: /^Play / }));
      const iframe = document.querySelector("iframe");
      expect(iframe?.getAttribute("title")).toBeTruthy();
    }
  });

  it("gives each tab a decorative icon and an unambiguous text label", () => {
    render(<DocsVideoCarousel />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      expect(tab.textContent).not.toContain("Intelligence");
    }
    expect(
      screen.getByRole("link", { name: "Watch on Loom" }).getAttribute("href"),
    ).toBe(`https://www.loom.com/share/${LOOM_IDS[0]}`);
  });

  it("identifies the Intelligence features in their descriptions without adding badges to tabs", () => {
    render(<DocsVideoCarousel />);
    expect(
      screen.queryByText("Available with CopilotKit Intelligence."),
    ).toBeNull();
    for (const tab of screen.getAllByRole("tab").slice(1)) {
      fireEvent.click(tab);
      expect(screen.getByRole("tabpanel").textContent).toContain(
        "Available with CopilotKit Intelligence.",
      );
      expect(tab.textContent).not.toContain("Intelligence");
    }
  });

  it("never renders an em-dash", () => {
    const { container } = render(<DocsVideoCarousel />);

    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      expect(container.innerHTML).not.toContain("—");
    }
  });
});
