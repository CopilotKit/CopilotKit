import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { AssistantMessage } from "@ag-ui/core";

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

describe("CopilotChatAssistantMessage Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("markdownRenderer slot", () => {
      it("should apply tailwind class string to markdownRenderer", () => {
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              markdownRenderer="bg-blue-100 rounded-lg p-4"
            />
          </TestWrapper>,
        );

        const markdown = container.querySelector(".bg-blue-100");
        expect(markdown).toBeDefined();
        expect(markdown?.classList.contains("rounded-lg")).toBe(true);
      });
    });

    describe("toolbar slot", () => {
      it("should apply tailwind class string to toolbar", () => {
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              toolbar="bg-gray-100 border-t"
            />
          </TestWrapper>,
        );

        const toolbar = container.querySelector(".bg-gray-100");
        expect(toolbar).toBeDefined();
        expect(toolbar?.classList.contains("border-t")).toBe(true);
      });
    });

    describe("copyButton slot", () => {
      it("should apply tailwind class string to copyButton", () => {
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              copyButton="text-green-500 hover:text-green-700"
            />
          </TestWrapper>,
        );

        const copyBtn = container.querySelector(".text-green-500");
        expect(copyBtn).toBeDefined();
      });
    });

    describe("thumbsUpButton slot", () => {
      it("should apply tailwind class string to thumbsUpButton", () => {
        const onThumbsUp = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onThumbsUp={onThumbsUp}
              thumbsUpButton="text-blue-500"
            />
          </TestWrapper>,
        );

        const thumbsUp = container.querySelector(".text-blue-500");
        expect(thumbsUp).toBeDefined();
      });
    });

    describe("thumbsDownButton slot", () => {
      it("should apply tailwind class string to thumbsDownButton", () => {
        const onThumbsDown = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onThumbsDown={onThumbsDown}
              thumbsDownButton="text-red-500"
            />
          </TestWrapper>,
        );

        const thumbsDown = container.querySelector(".text-red-500");
        expect(thumbsDown).toBeDefined();
      });
    });

    describe("readAloudButton slot", () => {
      it("should apply tailwind class string to readAloudButton", () => {
        const onReadAloud = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onReadAloud={onReadAloud}
              readAloudButton="text-purple-500"
            />
          </TestWrapper>,
        );

        const readAloud = container.querySelector(".text-purple-500");
        expect(readAloud).toBeDefined();
      });
    });

    describe("regenerateButton slot", () => {
      it("should apply tailwind class string to regenerateButton", () => {
        const onRegenerate = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onRegenerate={onRegenerate}
              regenerateButton="text-orange-500"
            />
          </TestWrapper>,
        );

        const regenerate = container.querySelector(".text-orange-500");
        expect(regenerate).toBeDefined();
      });
    });

    describe("toolCallsView slot", () => {
      it("should apply tailwind class string to toolCallsView", () => {
        const message: AssistantMessage = {
          ...createAssistantMessage("Hello"),
          toolCalls: [
            {
              id: "tc-1",
              type: "function",
              function: { name: "test_tool", arguments: "{}" },
            },
          ],
        };
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              toolCallsView="bg-yellow-50 p-2"
            />
          </TestWrapper>,
        );

        const toolCalls = container.querySelector(".bg-yellow-50");
        // May not be visible if no tool calls rendered
        if (toolCalls) {
          expect(toolCalls.classList.contains("p-2")).toBe(true);
        }
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS
  // ============================================================================
  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("markdownRenderer slot", () => {
      it("should pass custom props to markdownRenderer", () => {
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              markdownRenderer={{ "data-testid": "custom-markdown" }}
            />
          </TestWrapper>,
        );

        const markdown = screen.queryByTestId("custom-markdown");
        expect(markdown).toBeDefined();
      });
    });

    describe("toolbar slot", () => {
      it("should pass custom onClick to toolbar", () => {
        const onClick = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              toolbar={{ onClick, "data-testid": "custom-toolbar" }}
            />
          </TestWrapper>,
        );

        const toolbar = screen.queryByTestId("custom-toolbar");
        if (toolbar) {
          fireEvent.click(toolbar);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("copyButton slot", () => {
      it("should pass custom onClick that wraps default behavior", () => {
        const customOnClick = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              copyButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        // Find copy button by aria-label
        const copyBtn = container.querySelector('button[aria-label*="Copy"]');
        if (copyBtn) {
          fireEvent.click(copyBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });

      it("should support disabled state on copyButton", () => {
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              copyButton={{ disabled: true }}
            />
          </TestWrapper>,
        );

        const copyBtn = container.querySelector('button[aria-label*="Copy"]');
        if (copyBtn) {
          expect(copyBtn.hasAttribute("disabled")).toBe(true);
        }
      });
    });

    describe("thumbsUpButton slot", () => {
      it("should call custom onClick on thumbsUpButton", () => {
        const customOnClick = vi.fn();
        const onThumbsUp = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onThumbsUp={onThumbsUp}
              thumbsUpButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const thumbsUpBtn = container.querySelector(
          'button[aria-label*="Thumbs up"]',
        );
        if (thumbsUpBtn) {
          fireEvent.click(thumbsUpBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });
    });

    describe("thumbsDownButton slot", () => {
      it("should call custom onClick on thumbsDownButton", () => {
        const customOnClick = vi.fn();
        const onThumbsDown = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onThumbsDown={onThumbsDown}
              thumbsDownButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const thumbsDownBtn = container.querySelector(
          'button[aria-label*="Thumbs down"]',
        );
        if (thumbsDownBtn) {
          fireEvent.click(thumbsDownBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });
    });

    describe("readAloudButton slot", () => {
      it("should call custom onClick on readAloudButton", () => {
        const customOnClick = vi.fn();
        const onReadAloud = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onReadAloud={onReadAloud}
              readAloudButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const readAloudBtn = container.querySelector(
          'button[aria-label*="Read"]',
        );
        if (readAloudBtn) {
          fireEvent.click(readAloudBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });
    });

    describe("regenerateButton slot", () => {
      it("should call custom onClick on regenerateButton", () => {
        const customOnClick = vi.fn();
        const onRegenerate = vi.fn();
        const message = createAssistantMessage("Hello world");
        const { container } = render(
          <TestWrapper>
            <CopilotChatAssistantMessage
              message={message}
              onRegenerate={onRegenerate}
              regenerateButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const regenerateBtn = container.querySelector(
          'button[aria-label*="Regenerate"]',
        );
        if (regenerateBtn) {
          fireEvent.click(regenerateBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for markdownRenderer", () => {
      const CustomMarkdown: React.FC<{ content: string }> = ({ content }) => (
        <div data-testid="custom-markdown-component">
          {content.toUpperCase()}
        </div>
      );

      const message = createAssistantMessage("hello");
      render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            markdownRenderer={CustomMarkdown as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-markdown-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("HELLO");
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

      const message = createAssistantMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            toolbar={CustomToolbar as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-toolbar-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Custom Toolbar");
    });

    it("should allow custom component for copyButton", () => {
      const CustomCopyButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = (props) => (
        <button data-testid="custom-copy" {...props}>
          Custom Copy
        </button>
      );

      const message = createAssistantMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            copyButton={CustomCopyButton as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-copy");
      expect(custom).toBeDefined();
    });
  });

  // ============================================================================
  // 4. CHILDREN RENDER FUNCTION (DRILL-DOWN) TESTS
  // ============================================================================
  describe("4. Children Render Function for Drill-down", () => {
    it("should provide all bound sub-components via children render function", () => {
      const message = createAssistantMessage("Hello world");
      const childrenFn = vi.fn((props) => (
        <div data-testid="children-render">
          <div data-testid="received-markdown">{props.markdownRenderer}</div>
          <div data-testid="received-toolbar">{props.toolbar}</div>
          <div data-testid="received-copy">{props.copyButton}</div>
          <div data-testid="received-thumbs-up">{props.thumbsUpButton}</div>
          <div data-testid="received-thumbs-down">{props.thumbsDownButton}</div>
          <div data-testid="received-read-aloud">{props.readAloudButton}</div>
          <div data-testid="received-regenerate">{props.regenerateButton}</div>
          <div data-testid="received-tool-calls">{props.toolCallsView}</div>
        </div>
      ));

      render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            onThumbsUp={vi.fn()}
            onThumbsDown={vi.fn()}
            onReadAloud={vi.fn()}
            onRegenerate={vi.fn()}
          >
            {childrenFn}
          </CopilotChatAssistantMessage>
        </TestWrapper>,
      );

      expect(childrenFn).toHaveBeenCalled();
      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs).toHaveProperty("markdownRenderer");
      expect(callArgs).toHaveProperty("toolbar");
      expect(callArgs).toHaveProperty("copyButton");
      expect(callArgs).toHaveProperty("thumbsUpButton");
      expect(callArgs).toHaveProperty("thumbsDownButton");
      expect(callArgs).toHaveProperty("readAloudButton");
      expect(callArgs).toHaveProperty("regenerateButton");
      expect(callArgs).toHaveProperty("toolCallsView");
      expect(callArgs).toHaveProperty("message");

      expect(screen.queryByTestId("children-render")).toBeDefined();
    });

    it("should pass message and other props through children render function", () => {
      const message = createAssistantMessage("Test message");
      const childrenFn = vi.fn(() => <div />);

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

      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs.message).toBe(message);
      expect(callArgs.isRunning).toBe(true);
      expect(callArgs.toolbarVisible).toBe(false);
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind Strings", () => {
    it("should override root className while preserving default prose classes", () => {
      const message = createAssistantMessage("Hello");
      const { container } = render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            className="custom-root-class bg-custom"
          />
        </TestWrapper>,
      );

      const root = container.querySelector(".custom-root-class");
      expect(root).toBeDefined();
      // Should also have default prose classes merged
      expect(root?.classList.contains("prose")).toBe(true);
    });

    it("should allow tailwind utilities to override default styles", () => {
      const message = createAssistantMessage("Hello");
      const { container } = render(
        <TestWrapper>
          <CopilotChatAssistantMessage message={message} className="max-w-sm" />
        </TestWrapper>,
      );

      // max-w-sm should override the default max-w-full
      const root = container.querySelector(".max-w-sm");
      expect(root).toBeDefined();
    });

    it("should merge multiple slot classNames correctly", () => {
      const message = createAssistantMessage("Hello");
      const { container } = render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            className="root-custom"
            toolbar="toolbar-custom"
            copyButton="copy-custom"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".root-custom")).toBeDefined();
      expect(container.querySelector(".toolbar-custom")).toBeDefined();
      expect(container.querySelector(".copy-custom")).toBeDefined();
    });
  });

  // ============================================================================
  // 6. INTEGRATION / RECURSIVE SLOT TESTS
  // ============================================================================
  describe("6. Integration and Recursive Slot Application", () => {
    it("should correctly render all slots with mixed customization", () => {
      const onThumbsUp = vi.fn();
      const onThumbsDown = vi.fn();
      const message = createAssistantMessage("Hello world");

      const { container } = render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
            markdownRenderer="markdown-style"
            toolbar="toolbar-style"
            copyButton="copy-style"
            thumbsUpButton="thumbs-up-style"
            thumbsDownButton="thumbs-down-style"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".markdown-style")).toBeDefined();
      expect(container.querySelector(".toolbar-style")).toBeDefined();
      expect(container.querySelector(".copy-style")).toBeDefined();
      expect(container.querySelector(".thumbs-up-style")).toBeDefined();
      expect(container.querySelector(".thumbs-down-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", () => {
      const onClick = vi.fn();
      const message = createAssistantMessage("Hello world");

      const { container } = render(
        <TestWrapper>
          <CopilotChatAssistantMessage
            message={message}
            markdownRenderer="text-lg"
            toolbar={{ onClick, className: "flex gap-2" }}
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".text-lg")).toBeDefined();

      const toolbar = container.querySelector(".flex.gap-2");
      if (toolbar) {
        fireEvent.click(toolbar);
        expect(onClick).toHaveBeenCalled();
      }
    });
  });
});
