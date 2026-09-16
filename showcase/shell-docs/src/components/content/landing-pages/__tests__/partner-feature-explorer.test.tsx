// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PartnerFeatureExplorer } from "../partner-feature-explorer";

afterEach(cleanup);
describe("partner feature explorer", () => {
  it("loads only the selected partner demo and switches to product walkthroughs", () => {
    const href =
      "https://showcase.copilotkit.ai/angular/mastra/gen-ui-tool-based";
    render(
      <PartnerFeatureExplorer
        frameworkName="Mastra"
        hrefPrefix="/angular/mastra"
        demos={[
          {
            id: "gen-ui-tool-based",
            title: "Generative UI",
            description: "Interactive components",
            href,
          },
        ]}
      />,
    );
    expect(
      screen.getByTitle("Mastra: Generative UI live demo").getAttribute("src"),
    ).toBe(`${href}/preview`);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(
      screen
        .getAllByRole("button")
        .slice(0, 3)
        .map((button) => button.textContent),
    ).toEqual(["Rich Threads", "Automatic Learning", "Generative UI"]);
    fireEvent.click(screen.getByRole("button", { name: "Rich Threads" }));
    expect(screen.queryByTitle("Mastra: Generative UI live demo")).toBeNull();
    expect(screen.getByTitle("Rich Threads product walkthrough")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Read guide/ }).getAttribute("href"),
    ).toBe("/angular/mastra/threads");
  });
});
