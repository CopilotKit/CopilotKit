import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import type { CopilotChatAssistantMessageProps } from "../CopilotChatAssistantMessage";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import type { AssistantMessage } from "@ag-ui/core";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const createAssistantMessage = (content: string): AssistantMessage => ({
  id: "msg-1",
  role: "assistant",
  content,
});

function renderMessage(props: Partial<CopilotChatAssistantMessageProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotChatAssistantMessage
        message={createAssistantMessage("Hello world")}
        {...props}
      />
    </TestWrapper>,
  );
}

// Each toolbar button with the callback that makes it render.
const callbackButtons = [
  {
    slot: "thumbsUpButton",
    callback: "onThumbsUp",
    testId: "copilot-thumbs-up-button",
  },
  {
    slot: "thumbsDownButton",
    callback: "onThumbsDown",
    testId: "copilot-thumbs-down-button",
  },
  {
    slot: "readAloudButton",
    callback: "onReadAloud",
    testId: "copilot-read-aloud-button",
  },
  {
    slot: "regenerateButton",
    callback: "onRegenerate",
    testId: "copilot-regenerate-button",
  },
] as const;

// The copyButton string slot, custom button components and the children
// render prop are covered in CopilotChatAssistantMessage.test.tsx.
describe("CopilotChatAssistantMessage Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    it("should apply tailwind class string to markdownRenderer", () => {
      const { container } = renderMessage({
        markdownRenderer: "bg-blue-100 rounded-lg p-4",
      });

      expect(container.querySelector(".bg-blue-100")).toHaveClass("rounded-lg");
    });

    it("should apply tailwind class string to toolbar", () => {
      renderMessage({ toolbar: "bg-gray-100 border-t" });

      expect(screen.getByTestId("copilot-assistant-toolbar")).toHaveClass(
        "cpk-assistant-message-toolbar",
        "bg-gray-100",
        "border-t",
      );
    });

    it.each(callbackButtons)(
      "should apply tailwind class string to $slot",
      ({ slot, callback, testId }) => {
        renderMessage({ [callback]: vi.fn(), [slot]: "text-blue-500" });

        expect(screen.getByTestId(testId)).toHaveClass("text-blue-500");
      },
    );
  });

  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    it("should pass custom props to markdownRenderer", () => {
      const { container } = renderMessage({
        markdownRenderer: { className: "custom-markdown" },
      });

      expect(container.querySelector(".custom-markdown")).toHaveTextContent(
        "Hello world",
      );
    });

    it("should pass custom onClick and className to toolbar", () => {
      const onClick = vi.fn();
      renderMessage({ toolbar: { onClick, className: "flex gap-2" } });

      const toolbar = screen.getByTestId("copilot-assistant-toolbar");
      fireEvent.click(toolbar);

      expect(toolbar).toHaveClass("flex", "gap-2");
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should pass custom onClick to copyButton", () => {
      const customOnClick = vi.fn();
      renderMessage({ copyButton: { onClick: customOnClick } });

      fireEvent.click(screen.getByTestId("copilot-copy-button"));

      expect(customOnClick).toHaveBeenCalledTimes(1);
    });

    it("should support disabled state on copyButton", () => {
      renderMessage({ copyButton: { disabled: true } });

      expect(screen.getByTestId("copilot-copy-button")).toBeDisabled();
    });

    it.each(callbackButtons)(
      "a custom onClick on $slot replaces the default click action",
      ({ slot, callback, testId }) => {
        const customOnClick = vi.fn();
        const defaultCallback = vi.fn();
        renderMessage({
          [callback]: defaultCallback,
          [slot]: { onClick: customOnClick },
        });

        fireEvent.click(screen.getByTestId(testId));

        expect(customOnClick).toHaveBeenCalledTimes(1);
        expect(defaultCallback).not.toHaveBeenCalled();
      },
    );
  });

  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for markdownRenderer", () => {
      const CustomMarkdown: React.FC<{ content: string }> = ({ content }) => (
        <div data-testid="custom-markdown-component">
          {content.toUpperCase()}
        </div>
      );

      renderMessage({
        message: createAssistantMessage("hello"),
        markdownRenderer: CustomMarkdown,
      });

      expect(screen.getByTestId("custom-markdown-component")).toHaveTextContent(
        "HELLO",
      );
    });

    it("should allow custom component for toolbar", () => {
      const CustomToolbar: React.FC<React.PropsWithChildren> = ({
        children,
      }) => (
        <div data-testid="custom-toolbar-component">
          <span>Custom Toolbar:</span>
          {children}
        </div>
      );

      renderMessage({ toolbar: CustomToolbar });

      const custom = screen.getByTestId("custom-toolbar-component");
      expect(custom).toHaveTextContent("Custom Toolbar");
      // The custom toolbar still receives the bound buttons as children.
      expect(custom).toContainElement(
        screen.getByTestId("copilot-copy-button"),
      );
    });
  });

  describe("4. Children Render Function for Drill-down", () => {
    it("should pass message and other props through children render function", () => {
      const message = createAssistantMessage("Test message");
      const childrenFn = vi.fn(
        (_props: {
          message?: AssistantMessage;
          isRunning?: boolean;
          toolbarVisible?: boolean;
        }) => <div />,
      );

      render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            isRunning={true}
            toolbarVisible={false}
          >
            {childrenFn}
          </CopilotChatAssistantMessage>
        </TestWrapper>,
      );

      const callArgs = childrenFn.mock.calls[0]![0];
      expect(callArgs.message).toBe(message);
      expect(callArgs.isRunning).toBe(true);
      expect(callArgs.toolbarVisible).toBe(false);
    });
  });

  describe("5. className Override with Tailwind Strings", () => {
    it("should override root className while preserving the markdown typography class", () => {
      const { container } = renderMessage({
        message: createAssistantMessage("Hello"),
        className: "custom-root-class bg-custom",
      });

      const root = container.querySelector(".custom-root-class");
      expect(root).not.toBeNull();
      // Markdown typography is on an inner div wrapping the markdown content
      const markdownDiv = root?.querySelector(".cpk-markdown");
      expect(markdownDiv).not.toBeNull();
      expect(markdownDiv?.textContent).toContain("Hello");
    });
  });
});
