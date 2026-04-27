import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntegrationGrid } from "./IntegrationGrid";
import { integrations, defaultIntegration } from "../../integrations.config";

describe("<IntegrationGrid>", () => {
  it("renders one card per integration", () => {
    const { container } = render(<IntegrationGrid />);
    const cards = container.querySelectorAll('[data-integration-card]');
    expect(cards).toHaveLength(integrations.length);
  });

  it("links the default integration to /quickstart (no prefix)", () => {
    render(<IntegrationGrid />);
    const defaultDef = integrations.find((i) => i.slug === defaultIntegration)!;
    const link = screen.getByRole("link", { name: new RegExp(defaultDef.label, "i") });
    expect(link.getAttribute("href")).toBe("/quickstart");
  });

  it("links non-default integrations under their slug prefix", () => {
    render(<IntegrationGrid />);
    const langgraph = integrations.find((i) => i.slug === "langgraph")!;
    const link = screen.getByRole("link", { name: new RegExp(langgraph.label, "i") });
    expect(link.getAttribute("href")).toBe("/langgraph/quickstart");
  });

  it("marks the default integration with a 'Start here' badge", () => {
    render(<IntegrationGrid />);
    const badge = screen.getByText(/start here/i);
    expect(badge).toBeInTheDocument();
  });

  it("renders an icon chip for the default integration", () => {
    const { container } = render(<IntegrationGrid />);
    const built = container.querySelector('[data-integration-card="built-in"] [data-color-chip]');
    expect(built).not.toBeNull();
  });

  it("renders an SVG logo for each integration", () => {
    const { container } = render(<IntegrationGrid />);
    const svgs = container.querySelectorAll('[data-integration-card] svg');
    expect(svgs.length).toBeGreaterThanOrEqual(integrations.length);
  });
});
