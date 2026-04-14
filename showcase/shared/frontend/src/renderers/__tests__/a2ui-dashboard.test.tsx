import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock CopilotKit provider and sidebar
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

vi.mock("../../a2ui/renderers", () => ({
  demonstrationCatalog: { id: "mock-catalog" },
}));

import { A2UIDashboard } from "../a2ui";

describe("A2UIDashboard", () => {
  it("renders without crashing", () => {
    const { container } = render(<A2UIDashboard agentId="test-agent" />);
    expect(container.firstChild).toBeTruthy();
  });

  it("wraps content in a CopilotKit provider with correct agent", () => {
    render(<A2UIDashboard agentId="a2ui-agent" />);
    expect(capturedCopilotKitProps.agent).toBe("a2ui-agent");
    expect(capturedCopilotKitProps.runtimeUrl).toBe("/api/copilotkit");
  });

  it("passes a2ui catalog config to CopilotKit", () => {
    render(<A2UIDashboard agentId="test-agent" />);
    const a2uiConfig = capturedCopilotKitProps.a2ui as Record<string, unknown>;
    expect(a2uiConfig).toBeDefined();
    expect(a2uiConfig.catalog).toEqual({ id: "mock-catalog" });
  });

  it("a2ui config contains catalog key specifically", () => {
    render(<A2UIDashboard agentId="test-agent" />);
    const a2uiConfig = capturedCopilotKitProps.a2ui as Record<string, unknown>;
    expect(a2uiConfig).toBeDefined();
    expect("catalog" in a2uiConfig).toBe(true);
  });

  it("uses the demonstrationCatalog from a2ui/renderers", () => {
    render(<A2UIDashboard agentId="test-agent" />);
    const a2uiConfig = capturedCopilotKitProps.a2ui as Record<string, unknown>;
    // The mock returns { id: "mock-catalog" } which is exactly what should be passed
    expect(a2uiConfig.catalog).toEqual({ id: "mock-catalog" });
  });

  it("renders the CopilotSidebar", () => {
    const { getByTestId } = render(<A2UIDashboard agentId="test-agent" />);
    expect(getByTestId("copilot-sidebar")).toBeTruthy();
  });

  it("sets sidebar to default open with correct title", () => {
    render(<A2UIDashboard agentId="test-agent" />);
    expect(capturedSidebarProps.defaultOpen).toBe(true);
    expect(
      (capturedSidebarProps.labels as Record<string, string>).modalHeaderTitle,
    ).toBe("Sales Dashboard Assistant");
  });

  it("does not pass openGenerativeUI to CopilotKit", () => {
    render(<A2UIDashboard agentId="test-agent" />);
    expect(capturedCopilotKitProps.openGenerativeUI).toBeUndefined();
  });
});
