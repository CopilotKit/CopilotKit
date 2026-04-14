import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock CopilotKitProvider and CopilotSidebar -- they require runtime context
// we don't have in unit tests. We verify the adapter passes the right props.
let capturedProviderProps: Record<string, unknown> = {};
let capturedSidebarProps: Record<string, unknown> = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: (props: Record<string, unknown>) => {
    capturedProviderProps = props;
    return (
      <div data-testid="copilotkit-provider">
        {props.children as React.ReactNode}
      </div>
    );
  },
  CopilotSidebar: (props: Record<string, unknown>) => {
    capturedSidebarProps = props;
    return <div data-testid="copilot-sidebar" />;
  },
}));

vi.mock("../../hooks/use-showcase-hooks", () => ({
  useShowcaseHooks: vi.fn(),
}));

vi.mock("../../hooks/use-showcase-suggestions", () => ({
  useShowcaseSuggestions: vi.fn(),
}));

import { OpenGenUIDashboard } from "../open-genui";

describe("OpenGenUIDashboard", () => {
  it("renders without crashing", () => {
    const { container } = render(<OpenGenUIDashboard />);
    expect(container.firstChild).toBeTruthy();
  });

  it("wraps content in a CopilotKitProvider with openGenerativeUI enabled", () => {
    render(<OpenGenUIDashboard />);
    expect(capturedProviderProps.runtimeUrl).toBe("/api/copilotkit");
    expect(capturedProviderProps.openGenerativeUI).toEqual({});
  });

  it("openGenerativeUI is an empty object (not undefined or null)", () => {
    render(<OpenGenUIDashboard />);
    expect(capturedProviderProps.openGenerativeUI).toBeDefined();
    expect(typeof capturedProviderProps.openGenerativeUI).toBe("object");
    expect(
      Object.keys(capturedProviderProps.openGenerativeUI as object),
    ).toHaveLength(0);
  });

  it("does not pass a2ui config to provider", () => {
    render(<OpenGenUIDashboard />);
    expect(capturedProviderProps.a2ui).toBeUndefined();
  });

  it("does not pass agent prop to provider", () => {
    render(<OpenGenUIDashboard />);
    expect(capturedProviderProps.agent).toBeUndefined();
  });

  it("renders the CopilotSidebar", () => {
    const { getByTestId } = render(<OpenGenUIDashboard />);
    expect(getByTestId("copilot-sidebar")).toBeTruthy();
  });

  it("sets sidebar to default open with correct title", () => {
    render(<OpenGenUIDashboard />);
    expect(capturedSidebarProps.defaultOpen).toBe(true);
    expect(
      (capturedSidebarProps.labels as Record<string, string>).modalHeaderTitle,
    ).toBe("Open GenUI Dashboard");
  });

  it("shows placeholder text directing users to ask for a dashboard", () => {
    const { container } = render(<OpenGenUIDashboard />);
    expect(container.textContent).toContain("sales dashboard");
  });

  it("placeholder mentions HTML, CSS, and JavaScript", () => {
    const { container } = render(<OpenGenUIDashboard />);
    expect(container.textContent).toContain("HTML");
    expect(container.textContent).toContain("CSS");
    expect(container.textContent).toContain("JavaScript");
  });

  it("mentions secure sandbox in the placeholder", () => {
    const { container } = render(<OpenGenUIDashboard />);
    expect(container.textContent).toContain("sandbox");
  });
});
