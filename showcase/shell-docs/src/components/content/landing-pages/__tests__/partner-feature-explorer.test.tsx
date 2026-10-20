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
    fireEvent.click(screen.getByRole("button", { name: "AG-UI Streams" }));
    expect(screen.queryByTitle("Mastra: Generative UI live demo")).toBeNull();
    expect(screen.getByTitle("AG-UI Streams product walkthrough")).toBeTruthy();
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
