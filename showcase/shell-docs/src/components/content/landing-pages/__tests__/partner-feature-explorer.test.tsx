// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerFeatureExplorer } from "../partner-feature-explorer";

beforeEach(() => {
  // Embla measures layout; jsdom otherwise reports every slide as zero-width.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("partner-feature-item") ? 200 : 300;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(44);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("partner-feature-item")
        ? Array.from(this.parentElement!.children).indexOf(this) * 200
        : 0;
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("partner feature explorer", () => {
  it("starts with Chat and presents the requested feature order", () => {
    const ids = [
      "background-agents",
      "declarative-gen-ui",
      "shared-state-read-write",
      "frontend-tools",
      "hitl-in-chat",
      "gen-ui-tool-based",
      "agentic-chat",
    ];
    const titles = [
      "Background tasks",
      "Declarative UI",
      "Shared state",
      "Frontend tools",
      "Human approvals",
      "Generative UI",
      "Chat",
    ];
    render(
      <PartnerFeatureExplorer
        frameworkName="Mastra"
        demos={ids.map((id, i) => ({
          id,
          title: titles[i],
          description: "",
          href: `https://showcase.copilotkit.ai/react/mastra/${id}`,
          embedHref: `https://showcase-mastra-production.up.railway.app/demos/${id}`,
        }))}
      />,
    );
    expect(screen.getByTitle("Mastra: Chat live demo")).toBeTruthy();
    expect(
      screen
        .getAllByRole("button")
        .slice(1, -1)
        .map((button) => button.textContent),
    ).toEqual([
      "Chat",
      "Rich Threads",
      "Automatic Learning",
      "Generative UI",
      "Declarative UI",
      "Human-in-the-loop",
      "Frontend tools",
      "Shared state",
    ]);
  });
  it("loads only the selected partner demo and switches to product walkthroughs without a guide link", () => {
    const href =
      "https://showcase.copilotkit.ai/angular/mastra/gen-ui-tool-based";
    render(
      <PartnerFeatureExplorer
        frameworkName="Mastra"
        demos={[
          {
            id: "gen-ui-tool-based",
            title: "Generative UI",
            description: "Interactive components",
            href,
            embedHref:
              "https://showcase-mastra-production.up.railway.app/angular/gen-ui-tool-based",
          },
        ]}
      />,
    );
    expect(
      screen.getByTitle("Mastra: Generative UI live demo").getAttribute("src"),
    ).toBe(
      "https://showcase-mastra-production.up.railway.app/angular/gen-ui-tool-based",
    );
    expect(
      screen.queryByRole("link", { name: /Get started with/i }),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Generative UI" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(
      screen
        .getAllByRole("button")
        .slice(1, 4)
        .map((button) => button.textContent),
    ).toEqual(["Rich Threads", "Automatic Learning", "Generative UI"]);
    fireEvent.click(screen.getByRole("button", { name: "Rich Threads" }));
    expect(screen.queryByTitle("Mastra: Generative UI live demo")).toBeNull();
    expect(screen.getByTitle("Rich Threads product walkthrough")).toBeTruthy();
    expect(document.querySelector(".partner-explorer-caption")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next feature" }));
    expect(
      screen.getByTitle("Automatic Learning product walkthrough"),
    ).toBeTruthy();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Automatic Learning" }),
      {
        key: "ArrowRight",
      },
    );
    expect(screen.getByTitle("Mastra: Generative UI live demo")).toBeTruthy();
  });
});
