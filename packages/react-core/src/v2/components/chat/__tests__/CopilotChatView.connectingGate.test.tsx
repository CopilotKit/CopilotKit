import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

// Minimal provider wrapper. No agent registry is required because these tests
// only exercise local render decisions (welcome-screen suppression) that
// don't touch the agent runtime.
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 400 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

describe("CopilotChatView connect-gating", () => {
  it("suppresses the welcome screen while isConnecting=true", () => {
    render(
      <TestWrapper>
        <CopilotChatView messages={[]} isConnecting />
      </TestWrapper>,
    );

    // Switching threads would otherwise flash the welcome greeting before
    // bootstrap messages arrive.
    expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
  });

  it("still shows the welcome screen on an empty thread when hasExplicitThreadId=true", () => {
    render(
      <TestWrapper>
        <CopilotChatView messages={[]} hasExplicitThreadId />
      </TestWrapper>,
    );

    // The welcome screen is gated on message emptiness, not thread origin.
    // Apps that premint a UUID on mount (custom thread drawers, lock-recovery
    // rotation, BFF sync) must still see the welcome state on an empty thread.
    expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
  });

  it("shows the welcome screen by default for a fresh empty chat", () => {
    render(
      <TestWrapper>
        <CopilotChatView messages={[]} />
      </TestWrapper>,
    );

    // Positive control: with no threadId supplied and no connect in flight,
    // an empty chat should still render the welcome screen.
    expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
  });
});
