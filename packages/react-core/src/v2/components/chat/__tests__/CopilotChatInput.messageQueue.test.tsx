import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom";
import CopilotChatInput from "../CopilotChatInput";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="t">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

describe("CopilotChatInput + message queue props", () => {
  it("when queueEnabled + isRunning + input has text, send button invokes onSubmitMessage (not onStop)", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(
      <Wrapper>
        <CopilotChatInput
          isRunning
          queueEnabled
          value="hello"
          onChange={() => {}}
          onSubmitMessage={onSubmit}
          onStop={onStop}
        />
      </Wrapper>,
    );
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    fireEvent.click(sendButton);
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(onStop).not.toHaveBeenCalled();
  });

  it("when queueEnabled + isRunning + empty input, button still stops", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(
      <Wrapper>
        <CopilotChatInput
          isRunning
          queueEnabled
          value=""
          onChange={() => {}}
          onSubmitMessage={onSubmit}
          onStop={onStop}
        />
      </Wrapper>,
    );
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    fireEvent.click(sendButton);
    expect(onStop).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("when hasDrainableQueue + empty input + idle, send button is enabled", () => {
    const onSubmit = vi.fn();
    render(
      <Wrapper>
        <CopilotChatInput
          isRunning={false}
          hasDrainableQueue
          value=""
          onChange={() => {}}
          onSubmitMessage={onSubmit}
        />
      </Wrapper>,
    );
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("without queue props, existing behavior is preserved (isRunning → stop)", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(
      <Wrapper>
        <CopilotChatInput
          isRunning
          value="hello"
          onChange={() => {}}
          onSubmitMessage={onSubmit}
          onStop={onStop}
        />
      </Wrapper>,
    );
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    fireEvent.click(sendButton);
    expect(onStop).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
