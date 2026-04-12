import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssistantMessage } from "@ag-ui/core";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";

const TEST_THREAD_ID = "test-thread";

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        {component}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
};

describe("CopilotChatAssistantMessage thumbs callbacks (#3457)", () => {
  const message: AssistantMessage = {
    id: "msg-1",
    role: "assistant",
    content: "Hello from the assistant",
  };

  it("onThumbsUp receives AssistantMessage, not SyntheticEvent", () => {
    const onThumbsUp = vi.fn();

    renderWithProvider(
      <CopilotChatAssistantMessage message={message} onThumbsUp={onThumbsUp} />,
    );

    const thumbsUpButton = screen.getByRole("button", {
      name: /good response/i,
    });
    fireEvent.click(thumbsUpButton);

    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    const arg = onThumbsUp.mock.calls[0][0];
    // Should receive AssistantMessage
    expect(arg).toHaveProperty("id", "msg-1");
    expect(arg).toHaveProperty("role", "assistant");
    expect(arg).toHaveProperty("content", "Hello from the assistant");
    // Should NOT receive a SyntheticEvent (which has nativeEvent, target, etc.)
    expect(arg).not.toHaveProperty("nativeEvent");
  });

  it("onThumbsDown receives AssistantMessage, not SyntheticEvent", () => {
    const onThumbsDown = vi.fn();

    renderWithProvider(
      <CopilotChatAssistantMessage
        message={message}
        onThumbsDown={onThumbsDown}
      />,
    );

    const thumbsDownButton = screen.getByRole("button", {
      name: /bad response/i,
    });
    fireEvent.click(thumbsDownButton);

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    const arg = onThumbsDown.mock.calls[0][0];
    expect(arg).toHaveProperty("id", "msg-1");
    expect(arg).toHaveProperty("role", "assistant");
    expect(arg).toHaveProperty("content", "Hello from the assistant");
    expect(arg).not.toHaveProperty("nativeEvent");
  });
});
