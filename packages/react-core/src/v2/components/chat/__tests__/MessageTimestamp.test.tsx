import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssistantMessage, UserMessage } from "@ag-ui/core";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";

const EPOCH = Date.UTC(2026, 0, 2, 3, 4, 5);
const ISO = new Date(EPOCH).toISOString();

function renderWithTimestamps(
  element: React.ReactElement,
  options: {
    showTimestamps?: boolean;
    formatTimestamp?: (date: Date) => string;
  } = {},
) {
  const { showTimestamps = true, formatTimestamp } = options;
  return render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider
        threadId="test-thread"
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
      >
        {element}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

function timestampElement() {
  return screen.queryByTestId("copilot-message-timestamp");
}

describe("message timestamps", () => {
  const userMessage = {
    id: "user-1",
    role: "user",
    content: "Hello",
    metadata: { timestamp: EPOCH },
  } satisfies UserMessage;

  const assistantMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "Hi there",
    metadata: { timestamp: EPOCH },
  } satisfies AssistantMessage;

  it("renders a user message time when enabled", () => {
    renderWithTimestamps(<CopilotChatUserMessage message={userMessage} />);
    const time = timestampElement();
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe(ISO);
    expect(time?.textContent).not.toBe("");
  });

  it("renders an assistant message time when enabled", () => {
    renderWithTimestamps(
      <CopilotChatAssistantMessage message={assistantMessage} />,
    );
    expect(timestampElement()?.getAttribute("datetime")).toBe(ISO);
  });

  it("keeps the assistant time visible while that reply is running", () => {
    renderWithTimestamps(
      <CopilotChatAssistantMessage
        message={assistantMessage}
        messages={[assistantMessage]}
        isRunning
      />,
    );
    expect(timestampElement()).not.toBeNull();
  });

  it("renders nothing by default", () => {
    renderWithTimestamps(<CopilotChatUserMessage message={userMessage} />, {
      showTimestamps: false,
    });
    expect(timestampElement()).toBeNull();
  });

  it("renders nothing when the message has no time", () => {
    renderWithTimestamps(
      <CopilotChatUserMessage
        message={{ id: "user-2", role: "user", content: "Hello" }}
      />,
    );
    expect(timestampElement()).toBeNull();
  });

  it("uses formatTimestamp for the visible label", () => {
    renderWithTimestamps(
      <CopilotChatAssistantMessage message={assistantMessage} />,
      { formatTimestamp: () => "sent just now" },
    );
    const time = timestampElement();
    expect(time?.textContent).toBe("sent just now");
    expect(time?.getAttribute("datetime")).toBe(ISO);
  });

  it("renders nothing when the timestamp cannot be an ISO date", () => {
    renderWithTimestamps(
      <CopilotChatUserMessage
        message={{
          id: "user-invalid",
          role: "user",
          content: "Hello",
          metadata: { timestamp: 1e16 },
        }}
      />,
    );
    expect(timestampElement()).toBeNull();
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("reads a top-level timestamp", () => {
    renderWithTimestamps(
      <CopilotChatUserMessage
        message={
          {
            id: "user-3",
            role: "user",
            content: "Hello",
            timestamp: EPOCH,
          } as UserMessage
        }
      />,
    );
    expect(timestampElement()?.getAttribute("datetime")).toBe(ISO);
  });
});
