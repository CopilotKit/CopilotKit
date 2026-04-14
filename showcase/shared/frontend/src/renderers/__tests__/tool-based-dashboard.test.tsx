import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock CopilotKit provider and sidebar -- they require runtime context we
// don't have in unit tests. We verify the adapter passes the right props.
let capturedCopilotKitProps: Record<string, unknown> = {};
let capturedSidebarProps: Record<string, unknown> = {};

vi.mock("@copilotkit/react-core", () => ({
  CopilotKit: (props: Record<string, unknown>) => {
    capturedCopilotKitProps = props;
    return (
      <div data-testid="copilotkit-provider">
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotSidebar: (props: Record<string, unknown>) => {
    capturedSidebarProps = props;
    return <div data-testid="copilot-sidebar" />;
  },
  useAgent: () => ({
    agent: { state: {}, isRunning: false, setState: vi.fn() },
  }),
}));

vi.mock("../../hooks/use-showcase-hooks", () => ({
  useShowcaseHooks: vi.fn(),
}));

vi.mock("../../hooks/use-showcase-suggestions", () => ({
  useShowcaseSuggestions: vi.fn(),
}));

import { ToolBasedDashboard } from "../tool-based";

describe("ToolBasedDashboard", () => {
  it("renders without crashing", () => {
    const { container } = render(<ToolBasedDashboard agentId="test-agent" />);
    expect(container.firstChild).toBeTruthy();
  });

  it("wraps content in a CopilotKit provider with correct agent", () => {
    render(<ToolBasedDashboard agentId="my-sales-agent" />);
    expect(capturedCopilotKitProps.agent).toBe("my-sales-agent");
    expect(capturedCopilotKitProps.runtimeUrl).toBe("/api/copilotkit");
  });

  it("does not pass a2ui config to CopilotKit", () => {
    render(<ToolBasedDashboard agentId="test-agent" />);
    expect(capturedCopilotKitProps.a2ui).toBeUndefined();
  });

  it("does not pass a2ui catalog to CopilotKit", () => {
    render(<ToolBasedDashboard agentId="test-agent" />);
    // Explicitly verify no a2ui key at all (catalog is the sub-key)
    expect("a2ui" in capturedCopilotKitProps).toBe(false);
  });

  it("does not pass openGenerativeUI to CopilotKit", () => {
    render(<ToolBasedDashboard agentId="test-agent" />);
    expect(capturedCopilotKitProps.openGenerativeUI).toBeUndefined();
  });

  it("renders the CopilotSidebar", () => {
    const { getByTestId } = render(<ToolBasedDashboard agentId="test-agent" />);
    expect(getByTestId("copilot-sidebar")).toBeTruthy();
  });

  it("sets sidebar to default open with correct title", () => {
    render(<ToolBasedDashboard agentId="test-agent" />);
    expect(capturedSidebarProps.defaultOpen).toBe(true);
    expect(
      (capturedSidebarProps.labels as Record<string, string>).modalHeaderTitle,
    ).toBe("Sales Dashboard Assistant");
  });

  it("passes different agentId correctly", () => {
    render(<ToolBasedDashboard agentId="another-agent" />);
    expect(capturedCopilotKitProps.agent).toBe("another-agent");
  });
});
