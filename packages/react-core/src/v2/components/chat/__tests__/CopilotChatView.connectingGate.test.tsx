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

  it("suppresses the welcome screen when hasExplicitThreadId=true", () => {
    render(
      <TestWrapper>
        <CopilotChatView messages={[]} hasExplicitThreadId />
      </TestWrapper>,
    );

    // A caller-managed thread (threadId prop / config provider) should never
    // display the generic "start a new chat" welcome — even when the thread
    // has no messages yet.
    expect(screen.queryByTestId("copilot-welcome-screen")).toBeNull();
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

const CustomIndicator = () => <div data-testid="custom-indicator" />;

describe("CopilotChatView connecting indicator", () => {
  it("shows the indicator while connecting with no messages yet", () => {
    render(
      <TestWrapper>
        <CopilotChatView messages={[]} isConnecting hasExplicitThreadId />
      </TestWrapper>,
    );

    // Restoring a thread's history should not render as an empty panel.
    const indicator = screen.getByTestId("copilot-connecting-indicator");
    expect(indicator.getAttribute("role")).toBe("status");
    // The label is text content so screen readers announce the status region.
    expect(indicator.textContent).toBe("Loading conversation");
    expect(
      screen
        .getByTestId("copilot-chat")
        .getAttribute("data-copilot-connecting"),
    ).toBe("true");
  });

  it("hides the indicator once the connect has finished", () => {
    render(
      <TestWrapper>
        <CopilotChatView messages={[]} hasExplicitThreadId />
      </TestWrapper>,
    );

    expect(screen.queryByTestId("copilot-connecting-indicator")).toBeNull();
    expect(
      screen
        .getByTestId("copilot-chat")
        .getAttribute("data-copilot-connecting"),
    ).toBe("false");
  });

  it("hides the indicator once restored messages start arriving", () => {
    render(
      <TestWrapper>
        <CopilotChatView
          messages={[{ id: "m1", role: "user", content: "hello" }]}
          isConnecting
          hasExplicitThreadId
        />
      </TestWrapper>,
    );

    expect(screen.queryByTestId("copilot-connecting-indicator")).toBeNull();
  });

  it("does not render the indicator when connectingIndicator={false}", () => {
    render(
      <TestWrapper>
        <CopilotChatView
          messages={[]}
          isConnecting
          hasExplicitThreadId
          connectingIndicator={false}
        />
      </TestWrapper>,
    );

    expect(screen.queryByTestId("copilot-connecting-indicator")).toBeNull();
    // The attribute stays available for apps that render their own state.
    expect(
      screen
        .getByTestId("copilot-chat")
        .getAttribute("data-copilot-connecting"),
    ).toBe("true");
  });

  it("renders a custom connectingIndicator component", () => {
    render(
      <TestWrapper>
        <CopilotChatView
          messages={[]}
          isConnecting
          hasExplicitThreadId
          connectingIndicator={CustomIndicator}
        />
      </TestWrapper>,
    );

    expect(screen.getByTestId("custom-indicator")).toBeDefined();
    expect(screen.queryByTestId("copilot-connecting-indicator")).toBeNull();
  });
});
