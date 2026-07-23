// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { ChatContextProvider } from "./ChatContext";
import { Input } from "./Input";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

vi.mock("@copilotkit/react-core", () => ({
  useCopilotContext: () => ({
    copilotApiConfig: { publicApiKey: "test-key" },
  }),
  useCopilotChatInternal: () => ({
    interrupt: null,
  }),
}));

vi.mock("../../hooks/use-push-to-talk", () => ({
  usePushToTalk: () => ({
    pushToTalkState: "idle",
    setPushToTalkState: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

describe("Input", () => {
  it("handles the promise returned by onSend", () => {
    const sendPromise = new Promise<never>(() => {});
    const catchSpy = vi.spyOn(sendPromise, "catch");
    const onSend = vi.fn(() => sendPromise);

    render(
      <ChatContextProvider open={true} setOpen={vi.fn()}>
        <Input inProgress={false} chatReady={true} onSend={onSend} />
      </ChatContextProvider>,
    );

    fireEvent.change(screen.getByTestId("copilot-chat-textarea"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("copilot-send-button"));

    expect(onSend).toHaveBeenCalledWith("hello");
    expect(catchSpy).toHaveBeenCalledOnce();
  });
});
