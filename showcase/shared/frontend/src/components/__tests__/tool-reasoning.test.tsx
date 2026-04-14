import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolReasoning } from "../tool-reasoning";

describe("ToolReasoning", () => {
  it("shows tool name", () => {
    render(<ToolReasoning name="searchWeb" status="complete" />);
    expect(screen.getByText("searchWeb")).toBeTruthy();
  });

  it("shows spinner when status is executing", () => {
    const { container } = render(
      <ToolReasoning name="fetchData" status="executing" />,
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows spinner when status is inProgress", () => {
    const { container } = render(
      <ToolReasoning name="fetchData" status="inProgress" />,
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows checkmark SVG when status is complete", () => {
    const { container } = render(
      <ToolReasoning name="fetchData" status="complete" />,
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
    // Check for the emerald-500 checkmark svg
    const checkSvg = container.querySelector("svg.text-emerald-500");
    expect(checkSvg).toBeTruthy();
  });

  it("shows expandable args section with entries", () => {
    const args = { query: "weather NYC", limit: 5 };
    render(<ToolReasoning name="searchWeb" args={args} status="complete" />);
    expect(screen.getByText("query:")).toBeTruthy();
    expect(screen.getByText('"weather NYC"')).toBeTruthy();
    expect(screen.getByText("limit:")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders details element when args are present", () => {
    const args = { url: "https://example.com" };
    const { container } = render(
      <ToolReasoning name="fetch" args={args} status="executing" />,
    );
    expect(container.querySelector("details")).toBeTruthy();
  });

  it("does not render details element when no args", () => {
    const { container } = render(
      <ToolReasoning name="noArgs" status="complete" />,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("formats array values as item count", () => {
    const args = { items: [1, 2, 3] };
    render(<ToolReasoning name="process" args={args} status="complete" />);
    expect(screen.getByText("[3 items]")).toBeTruthy();
  });

  it("formats object values as key count", () => {
    const args = { config: { a: 1, b: 2 } };
    render(<ToolReasoning name="process" args={args} status="complete" />);
    expect(screen.getByText("{2 keys}")).toBeTruthy();
  });
});
