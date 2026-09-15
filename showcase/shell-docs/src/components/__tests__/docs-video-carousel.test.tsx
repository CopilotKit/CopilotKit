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
  it("labels the walkthrough region without a separate heading bar", () => {
    render(<DocsVideoCarousel />);
    expect(
      screen.getByRole("region", { name: "Product walkthroughs" }),
    ).not.toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders all three tabs, in the documented order, with their titles", () => {
    render(<DocsVideoCarousel />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tabTitle(tab))).toEqual(TITLES);
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
    expect(document.querySelector("img")?.getAttribute("src")).toMatch(
      /\.jpg$/,
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
  });

  it("keeps the caption row removed and offers a fallback inside the active player", () => {
    render(<DocsVideoCarousel />);
    for (const [index, tab] of screen.getAllByRole("tab").entries()) {
      fireEvent.click(tab);
      expect(
        screen.queryByText(/Available with CopilotKit Intelligence/),
      ).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^Play / }));
      expect(
        screen.getByRole("link", { name: "Open on Loom" }).getAttribute("href"),
      ).toBe(`https://www.loom.com/share/${LOOM_IDS[index]}`);
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
