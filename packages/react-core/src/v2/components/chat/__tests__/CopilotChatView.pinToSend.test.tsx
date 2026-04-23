import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatView } from "../CopilotChatView";
import { LastUserMessageContext } from "../last-user-message-context";

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

// Wrapper to provide required context (same pattern as CopilotChatView.slots.e2e.test.tsx)
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 400 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

// Wait for the ScrollView's `hasMounted` useEffect to flip — the pre-mount
// fallback render does not include the message list, so a findBy on the
// message list is a reliable "mount is done" signal. Without this gate,
// absence assertions pass vacuously against the pre-mount render.
async function waitForMount(screen: {
  findByTestId: (id: string) => Promise<HTMLElement>;
}) {
  await screen.findByTestId("copilot-message-list");
}

describe("CopilotChatView pin-to-send mode", () => {
  it("renders the pin-to-send spacer element when autoScroll='pin-to-send'", async () => {
    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView autoScroll="pin-to-send" messages={sampleMessages} />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).not.toBeNull();
  });

  it("does not render the spacer when autoScroll='pin-to-bottom'", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll="pin-to-bottom" messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("does not render the spacer when autoScroll='none'", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll="none" messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("boolean true still maps to pin-to-bottom (back-compat)", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll={true} messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("boolean false still maps to none (back-compat)", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll={false} messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });
});
