import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { vi } from "vitest";

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
  it("renders only the restore gate while restoration is in progress", () => {
    render(
      <TestWrapper>
        <CopilotChatView
          messages={[]}
          threadRestore={{
            status: "restoring",
            threadId: "test-thread",
            elapsedMs: 0,
            reloadConversation: vi.fn(),
          }}
        />
      </TestWrapper>,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Restoring conversation…",
    );
    expect(screen.queryByPlaceholderText("Type a message...")).toBeNull();
  });

  it("passes restore state and actions to a replacement restoreView slot", () => {
    const RestoreView = vi.fn(
      ({ threadRestore }: { threadRestore: { status: string } }) => (
        <div>Custom {threadRestore.status}</div>
      ),
    );

    render(
      <TestWrapper>
        <CopilotChatView
          messages={[]}
          restoreView={RestoreView}
          threadRestore={{
            status: "restoring",
            threadId: "test-thread",
            elapsedMs: 0,
            reloadConversation: vi.fn(),
          }}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Custom restoring")).not.toBeNull();
    expect(RestoreView).toHaveBeenCalled();
  });

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
