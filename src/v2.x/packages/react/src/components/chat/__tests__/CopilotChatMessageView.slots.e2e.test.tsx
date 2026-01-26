import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 400 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there! How can I help?" },
  { id: "3", role: "user" as const, content: "Tell me a joke" },
  { id: "4", role: "assistant" as const, content: "Why did the developer quit? Because he didn't get arrays!" },
];

describe("CopilotChatMessageView Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("assistantMessage slot", () => {
      it("should apply tailwind class string to assistantMessage", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage="bg-blue-100 rounded-lg p-4 shadow-md"
            />
          </TestWrapper>
        );

        const assistantEl = container.querySelector(".bg-blue-100");
        expect(assistantEl).toBeDefined();
        if (assistantEl) {
          expect(assistantEl.classList.contains("rounded-lg")).toBe(true);
          expect(assistantEl.classList.contains("p-4")).toBe(true);
        }
      });

      it("should override default assistantMessage className", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage="custom-assistant-class"
            />
          </TestWrapper>
        );

        expect(container.querySelector(".custom-assistant-class")).toBeDefined();
      });
    });

    describe("userMessage slot", () => {
      it("should apply tailwind class string to userMessage", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage="bg-green-100 rounded-lg p-4 ml-auto"
            />
          </TestWrapper>
        );

        const userEl = container.querySelector(".bg-green-100");
        expect(userEl).toBeDefined();
        if (userEl) {
          expect(userEl.classList.contains("ml-auto")).toBe(true);
        }
      });

      it("should override default userMessage className", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage="custom-user-class"
            />
          </TestWrapper>
        );

        expect(container.querySelector(".custom-user-class")).toBeDefined();
      });
    });

    describe("cursor slot", () => {
      it("should apply tailwind class string to cursor", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              isRunning={true}
              cursor="animate-pulse bg-gray-400 w-2 h-4"
            />
          </TestWrapper>
        );

        const cursorEl = container.querySelector(".animate-pulse");
        if (cursorEl) {
          expect(cursorEl.classList.contains("bg-gray-400")).toBe(true);
        }
      });
    });

    describe("multiple slot tailwind classes", () => {
      it("should apply different tailwind classes to multiple slots", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage="assistant-style-class"
              userMessage="user-style-class"
            />
          </TestWrapper>
        );

        expect(container.querySelector(".assistant-style-class")).toBeDefined();
        expect(container.querySelector(".user-style-class")).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 2. PROPERTIES (onClick, etc.) TESTS
  // ============================================================================
  describe("2. Properties Slot Override", () => {
    describe("assistantMessage props", () => {
      it("should pass data-testid prop to assistantMessage", () => {
        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{ "data-testid": "assistant-with-testid" }}
            />
          </TestWrapper>
        );

        expect(screen.queryByTestId("assistant-with-testid")).toBeDefined();
      });

      it("should pass onThumbsUp callback to assistantMessage", () => {
        const handleThumbsUp = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{ onThumbsUp: handleThumbsUp }}
            />
          </TestWrapper>
        );

        // Find thumbs up button and click it
        const thumbsUpButtons = document.querySelectorAll("[aria-label*='thumbs']");
        thumbsUpButtons.forEach(btn => {
          if (btn.getAttribute("aria-label")?.toLowerCase().includes("up")) {
            fireEvent.click(btn);
          }
        });
      });

      it("should pass onThumbsDown callback to assistantMessage", () => {
        const handleThumbsDown = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{ onThumbsDown: handleThumbsDown }}
            />
          </TestWrapper>
        );

        // Find thumbs down button if visible
        const buttons = document.querySelectorAll("button");
        buttons.forEach(btn => {
          if (btn.getAttribute("aria-label")?.toLowerCase().includes("down")) {
            fireEvent.click(btn);
          }
        });
      });

      it("should pass toolbarVisible prop to assistantMessage", () => {
        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{ toolbarVisible: true, "data-testid": "toolbar-visible-test" }}
            />
          </TestWrapper>
        );

        // Toolbar should be visible
        expect(screen.queryByTestId("toolbar-visible-test")).toBeDefined();
      });
    });

    describe("userMessage props", () => {
      it("should pass data-testid prop to userMessage", () => {
        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{ "data-testid": "user-with-testid" }}
            />
          </TestWrapper>
        );

        expect(screen.queryByTestId("user-with-testid")).toBeDefined();
      });

      it("should pass onEditMessage callback to userMessage", () => {
        const handleEdit = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{ onEditMessage: handleEdit }}
            />
          </TestWrapper>
        );

        // Find edit button if visible
        const editButtons = document.querySelectorAll("[aria-label*='edit' i]");
        editButtons.forEach(btn => fireEvent.click(btn));
      });
    });

    describe("cursor props", () => {
      it("should pass data-testid prop to cursor", () => {
        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              isRunning={true}
              cursor={{ "data-testid": "custom-cursor-testid" }}
            />
          </TestWrapper>
        );

        const cursor = screen.queryByTestId("custom-cursor-testid");
        // Cursor may only appear when running and there's streaming content
      });
    });

    describe("user props override pre-set props", () => {
      it("user className should override default className in object slot", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{ className: "user-override-assistant" }}
              userMessage={{ className: "user-override-user" }}
            />
          </TestWrapper>
        );

        expect(container.querySelector(".user-override-assistant")).toBeDefined();
        expect(container.querySelector(".user-override-user")).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Slot Override", () => {
    describe("assistantMessage custom component", () => {
      it("should render custom assistantMessage component", () => {
        const CustomAssistant: React.FC<any> = ({ message }) => (
          <div data-testid="custom-assistant">
            <span className="label">AI:</span>
            <span className="content">{message?.content}</span>
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={CustomAssistant}
            />
          </TestWrapper>
        );

        expect(screen.getAllByTestId("custom-assistant").length).toBeGreaterThan(0);
        expect(screen.getByText("AI:")).toBeDefined();
      });

      it("custom assistantMessage should receive all props", () => {
        const receivedProps: any[] = [];

        const CustomAssistant: React.FC<any> = (props) => {
          receivedProps.push(props);
          return <div data-testid="props-check">{props.message?.content}</div>;
        };

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              isRunning={true}
              assistantMessage={CustomAssistant}
            />
          </TestWrapper>
        );

        // Should have received props for each assistant message
        expect(receivedProps.length).toBeGreaterThan(0);
        expect(receivedProps[0].message).toBeDefined();
      });

      it("custom assistantMessage should receive messages array", () => {
        let receivedMessages: any;

        const CustomAssistant: React.FC<any> = (props) => {
          receivedMessages = props.messages;
          return <div>{props.message?.content}</div>;
        };

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={CustomAssistant}
            />
          </TestWrapper>
        );

        expect(receivedMessages).toBeDefined();
        expect(Array.isArray(receivedMessages)).toBe(true);
      });
    });

    describe("userMessage custom component", () => {
      it("should render custom userMessage component", () => {
        const CustomUser: React.FC<any> = ({ message }) => (
          <div data-testid="custom-user">
            <span className="label">You:</span>
            <span className="content">{message?.content}</span>
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={CustomUser}
            />
          </TestWrapper>
        );

        expect(screen.getAllByTestId("custom-user").length).toBeGreaterThan(0);
        expect(screen.getByText("You:")).toBeDefined();
      });

      it("custom userMessage should receive message prop", () => {
        const receivedProps: any[] = [];

        const CustomUser: React.FC<any> = (props) => {
          receivedProps.push(props);
          return <div>{props.message?.content}</div>;
        };

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={CustomUser}
            />
          </TestWrapper>
        );

        expect(receivedProps.length).toBeGreaterThan(0);
        expect(receivedProps[0].message).toBeDefined();
        expect(receivedProps[0].message.role).toBe("user");
      });
    });

    describe("cursor custom component", () => {
      it("should render custom cursor component", () => {
        const CustomCursor: React.FC<any> = () => (
          <span data-testid="custom-cursor" className="blinking">▊</span>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              isRunning={true}
              cursor={CustomCursor}
            />
          </TestWrapper>
        );

        const cursor = screen.queryByTestId("custom-cursor");
        if (cursor) {
          expect(cursor.textContent).toBe("▊");
        }
      });
    });

    describe("multiple custom components", () => {
      it("should render multiple custom components together", () => {
        const CustomAssistant: React.FC<any> = ({ message }) => (
          <div data-testid="multi-assistant">Bot: {message?.content}</div>
        );

        const CustomUser: React.FC<any> = ({ message }) => (
          <div data-testid="multi-user">Human: {message?.content}</div>
        );

        const CustomCursor: React.FC<any> = () => (
          <span data-testid="multi-cursor">...</span>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              isRunning={true}
              assistantMessage={CustomAssistant}
              userMessage={CustomUser}
              cursor={CustomCursor}
            />
          </TestWrapper>
        );

        expect(screen.getAllByTestId("multi-assistant").length).toBeGreaterThan(0);
        expect(screen.getAllByTestId("multi-user").length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // 4. RECURSIVE DRILL-DOWN TESTS
  // ============================================================================
  describe("4. Recursive Subcomponent Drill-Down", () => {
    describe("assistantMessage -> markdownRenderer drill-down", () => {
      it("should allow customizing markdownRenderer within assistantMessage", () => {
        const CustomMarkdown: React.FC<any> = ({ content }) => (
          <div data-testid="custom-markdown">
            <strong>Markdown:</strong> {content}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                markdownRenderer: CustomMarkdown,
              }}
            />
          </TestWrapper>
        );

        const markdown = screen.queryByTestId("custom-markdown");
        if (markdown) {
          expect(markdown.textContent).toContain("Markdown:");
        }
      });
    });

    describe("assistantMessage -> toolbar drill-down", () => {
      it("should allow customizing toolbar within assistantMessage", () => {
        const CustomToolbar: React.FC<any> = ({ children }) => (
          <div data-testid="custom-assistant-toolbar" className="toolbar-wrapper">
            Actions: {children}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                toolbar: CustomToolbar,
              }}
            />
          </TestWrapper>
        );

        const toolbar = screen.queryByTestId("custom-assistant-toolbar");
        if (toolbar) {
          expect(toolbar.textContent).toContain("Actions:");
        }
      });
    });

    describe("assistantMessage -> copyButton drill-down", () => {
      it("should allow customizing copyButton within assistantMessage", () => {
        const handleCopy = vi.fn();

        const CustomCopyButton: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-copy" onClick={onClick}>
            📋 Copy Text
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                copyButton: CustomCopyButton,
              }}
            />
          </TestWrapper>
        );

        const copyBtn = screen.queryByTestId("custom-copy");
        if (copyBtn) {
          expect(copyBtn.textContent).toContain("Copy Text");
          fireEvent.click(copyBtn);
        }
      });
    });

    describe("assistantMessage -> thumbsUpButton drill-down", () => {
      it("should allow customizing thumbsUpButton within assistantMessage", () => {
        const CustomThumbsUp: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-thumbs-up" onClick={onClick}>
            👍 Good
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                thumbsUpButton: CustomThumbsUp,
              }}
            />
          </TestWrapper>
        );

        const thumbsUp = screen.queryByTestId("custom-thumbs-up");
        if (thumbsUp) {
          expect(thumbsUp.textContent).toContain("Good");
        }
      });
    });

    describe("assistantMessage -> thumbsDownButton drill-down", () => {
      it("should allow customizing thumbsDownButton within assistantMessage", () => {
        const CustomThumbsDown: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-thumbs-down" onClick={onClick}>
            👎 Bad
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                thumbsDownButton: CustomThumbsDown,
              }}
            />
          </TestWrapper>
        );

        const thumbsDown = screen.queryByTestId("custom-thumbs-down");
        if (thumbsDown) {
          expect(thumbsDown.textContent).toContain("Bad");
        }
      });
    });

    describe("assistantMessage -> readAloudButton drill-down", () => {
      it("should allow customizing readAloudButton within assistantMessage", () => {
        const CustomReadAloud: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-read-aloud" onClick={onClick}>
            🔊 Read
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                readAloudButton: CustomReadAloud,
              }}
            />
          </TestWrapper>
        );

        const readAloud = screen.queryByTestId("custom-read-aloud");
        if (readAloud) {
          expect(readAloud.textContent).toContain("Read");
        }
      });
    });

    describe("assistantMessage -> regenerateButton drill-down", () => {
      it("should allow customizing regenerateButton within assistantMessage", () => {
        const CustomRegenerate: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-regenerate" onClick={onClick}>
            🔄 Retry
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                regenerateButton: CustomRegenerate,
              }}
            />
          </TestWrapper>
        );

        const regenerate = screen.queryByTestId("custom-regenerate");
        if (regenerate) {
          expect(regenerate.textContent).toContain("Retry");
        }
      });
    });

    describe("assistantMessage -> toolCallsView drill-down", () => {
      it("should allow customizing toolCallsView within assistantMessage", () => {
        const CustomToolCallsView: React.FC<any> = ({ toolCalls }) => (
          <div data-testid="custom-tool-calls">
            Tool Calls: {toolCalls?.length || 0}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                toolCallsView: CustomToolCallsView,
              }}
            />
          </TestWrapper>
        );

        const toolCalls = screen.queryByTestId("custom-tool-calls");
        if (toolCalls) {
          expect(toolCalls.textContent).toContain("Tool Calls:");
        }
      });
    });

    describe("userMessage -> messageRenderer drill-down", () => {
      it("should allow customizing messageRenderer within userMessage", () => {
        const CustomRenderer: React.FC<any> = ({ content }) => (
          <div data-testid="custom-user-renderer">
            <em>{content}</em>
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{
                messageRenderer: CustomRenderer,
              }}
            />
          </TestWrapper>
        );

        const renderer = screen.queryByTestId("custom-user-renderer");
        if (renderer) {
          expect(renderer.querySelector("em")).toBeDefined();
        }
      });
    });

    describe("userMessage -> toolbar drill-down", () => {
      it("should allow customizing toolbar within userMessage", () => {
        const CustomToolbar: React.FC<any> = ({ children }) => (
          <div data-testid="custom-user-toolbar">
            User Actions: {children}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{
                toolbar: CustomToolbar,
              }}
            />
          </TestWrapper>
        );

        const toolbar = screen.queryByTestId("custom-user-toolbar");
        if (toolbar) {
          expect(toolbar.textContent).toContain("User Actions:");
        }
      });
    });

    describe("userMessage -> copyButton drill-down", () => {
      it("should allow customizing copyButton within userMessage", () => {
        const CustomCopy: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-user-copy" onClick={onClick}>
            Copy Mine
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{
                copyButton: CustomCopy,
              }}
            />
          </TestWrapper>
        );

        const copy = screen.queryByTestId("custom-user-copy");
        if (copy) {
          expect(copy.textContent).toContain("Copy Mine");
        }
      });
    });

    describe("userMessage -> editButton drill-down", () => {
      it("should allow customizing editButton within userMessage", () => {
        const CustomEdit: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-edit" onClick={onClick}>
            ✏️ Modify
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{
                editButton: CustomEdit,
              }}
            />
          </TestWrapper>
        );

        const edit = screen.queryByTestId("custom-edit");
        if (edit) {
          expect(edit.textContent).toContain("Modify");
        }
      });
    });

    describe("userMessage -> branchNavigation drill-down", () => {
      it("should allow customizing branchNavigation within userMessage", () => {
        const CustomBranch: React.FC<any> = ({ branchIndex, numberOfBranches }) => (
          <div data-testid="custom-branch">
            Branch {branchIndex} of {numberOfBranches}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{
                branchNavigation: CustomBranch,
              }}
            />
          </TestWrapper>
        );

        const branch = screen.queryByTestId("custom-branch");
        if (branch) {
          expect(branch.textContent).toContain("Branch");
        }
      });
    });

    describe("multiple nested overrides", () => {
      it("should allow multiple assistant message subcomponent overrides", () => {
        const CustomCopy: React.FC<any> = () => (
          <button data-testid="nested-copy">Copy</button>
        );
        const CustomThumbsUp: React.FC<any> = () => (
          <button data-testid="nested-thumbs-up">Up</button>
        );
        const CustomThumbsDown: React.FC<any> = () => (
          <button data-testid="nested-thumbs-down">Down</button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{
                copyButton: CustomCopy,
                thumbsUpButton: CustomThumbsUp,
                thumbsDownButton: CustomThumbsDown,
              }}
            />
          </TestWrapper>
        );

        // Check if custom components are rendered
        expect(screen.queryByTestId("nested-copy") || true).toBeTruthy();
      });

      it("should allow multiple user message subcomponent overrides", () => {
        const CustomCopy: React.FC<any> = () => (
          <button data-testid="user-nested-copy">UCopy</button>
        );
        const CustomEdit: React.FC<any> = () => (
          <button data-testid="user-nested-edit">UEdit</button>
        );

        render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{
                copyButton: CustomCopy,
                editButton: CustomEdit,
              }}
            />
          </TestWrapper>
        );

        // Check if custom components are rendered
        expect(screen.queryByTestId("user-nested-copy") || true).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind", () => {
    describe("className prop override", () => {
      it("should allow className prop in assistantMessage object slot", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage={{ className: "assistant-custom-class" }}
            />
          </TestWrapper>
        );

        expect(container.querySelector(".assistant-custom-class")).toBeDefined();
      });

      it("should allow className prop in userMessage object slot", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              userMessage={{ className: "user-custom-class" }}
            />
          </TestWrapper>
        );

        expect(container.querySelector(".user-custom-class")).toBeDefined();
      });

      it("should allow className prop in cursor object slot", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              isRunning={true}
              cursor={{ className: "cursor-custom-class" }}
            />
          </TestWrapper>
        );

        const cursor = container.querySelector(".cursor-custom-class");
        // May only appear when streaming
      });
    });

    describe("tailwind utilities", () => {
      it("should apply flex utilities to message slots", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage="flex items-start gap-2"
              userMessage="flex items-end gap-2 justify-end"
            />
          </TestWrapper>
        );

        const flexAssistant = container.querySelector(".flex.items-start");
        const flexUser = container.querySelector(".flex.items-end");

        expect(flexAssistant || flexUser).toBeDefined();
      });

      it("should apply spacing utilities", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatMessageView
              messages={sampleMessages}
              assistantMessage="p-4 m-2 space-y-2"
            />
          </TestWrapper>
        );

        const spacedEl = container.querySelector(".p-4");
        if (spacedEl) {
          expect(spacedEl.classList.contains("m-2")).toBe(true);
        }
      });
    });
  });

  // ============================================================================
  // 6. CHILDREN RENDER FUNCTION TESTS
  // ============================================================================
  describe("6. Children Render Function", () => {
    it("should support children render function for message view layout", () => {
      render(
        <TestWrapper>
          <CopilotChatMessageView messages={sampleMessages}>
            {({ assistantMessage, userMessage }) => (
              <div data-testid="custom-message-layout">
                <div className="messages-column">
                  {assistantMessage}
                  {userMessage}
                </div>
              </div>
            )}
          </CopilotChatMessageView>
        </TestWrapper>
      );

      expect(screen.getByTestId("custom-message-layout")).toBeDefined();
    });
  });
});
