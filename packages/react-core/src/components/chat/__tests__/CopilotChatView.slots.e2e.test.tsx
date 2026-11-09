import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import type { CopilotChatViewProps } from "../CopilotChatView";
import type { CopilotChatMessageView } from "../CopilotChatMessageView";
import type { CopilotChatInput } from "../CopilotChatInput";
import type { CopilotChatSuggestionView } from "../CopilotChatSuggestionView";
import type { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import type { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import type { CopilotChatSuggestionPillProps } from "../CopilotChatSuggestionPill";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

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
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

const sampleSuggestions = [
  { title: "Test", message: "Test message", isLoading: false },
];

function renderView(props: Partial<CopilotChatViewProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotChatView messages={sampleMessages} {...props} />
    </TestWrapper>,
  );
}

/** Where an element's box ends, in viewport coordinates. */
function setBottom(el: Element, bottom: number) {
  el.getBoundingClientRect = () => DOMRect.fromRect({ height: bottom });
}

/**
 * Renders the view with `autoScroll="none"` and moves the messages 400px
 * below the viewport, so the scroll-to-bottom button shows.
 */
async function renderScrolledUp(
  scrollView: CopilotChatViewProps["scrollView"],
) {
  const utils = renderView({ autoScroll: "none", scrollView });
  await screen.findByTestId("copilot-message-list");
  const content = utils.container.querySelector(
    ".cpk-chat-view-scroll-content",
  );
  const viewport = content?.parentElement;
  if (!content || !viewport) throw new Error("scroll view did not mount");
  setBottom(viewport, 300);
  setBottom(content, 700);
  fireEvent.scroll(viewport);
  return utils;
}

describe("CopilotChatView Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    it("should apply tailwind class string to messageView", () => {
      renderView({ messageView: "bg-red-500 text-white p-4" });

      const messageContainer = document.querySelector('[class*="bg-red-500"]');
      expect(messageContainer).toHaveClass("text-white", "p-4");
    });

    it("should apply tailwind class string to scrollView", () => {
      const { container } = renderView({
        scrollView: "overflow-y-auto bg-gray-100",
      });

      expect(container.querySelector(".overflow-y-auto")).toHaveClass(
        "bg-gray-100",
      );
    });

    it("should apply tailwind class string to scrollToBottomButton via scrollView", async () => {
      await renderScrolledUp({
        scrollToBottomButton: "bg-blue-500 rounded-full",
      });

      expect(screen.getByTestId("copilot-scroll-to-bottom")).toHaveClass(
        "cpk-chat-view-scroll-to-bottom-button",
        "bg-blue-500",
        "rounded-full",
      );
    });

    it("merges a tailwind class string into the input's default classes", () => {
      const { container } = renderView({ input: "border-2 border-purple-500" });

      expect(container.querySelector(".cpk-chat-input")).toHaveClass(
        "border-2",
        "border-purple-500",
      );
    });

    it("should apply tailwind class string to feather via scrollView", () => {
      const { container } = renderView({
        scrollView: { feather: "text-green-500 font-bold" },
      });

      expect(container.querySelector(".text-green-500")).toHaveClass(
        "font-bold",
      );
    });

    it("should apply tailwind class string to suggestionView", () => {
      const { container } = renderView({
        suggestions: sampleSuggestions,
        suggestionView: "flex gap-2 bg-indigo-50",
      });

      expect(
        container.querySelector(".cpk-chat-view-suggestion-view"),
      ).toHaveClass("bg-indigo-50");
    });
  });

  describe("2. Properties Slot Override", () => {
    describe("scrollToBottomButton props (nested under scrollView)", () => {
      it("should pass onClick handler to scrollToBottomButton via scrollView", async () => {
        const handleClick = vi.fn();
        await renderScrolledUp({
          scrollToBottomButton: { onClick: handleClick },
        });

        fireEvent.click(screen.getByTestId("copilot-scroll-to-bottom"));

        expect(handleClick).toHaveBeenCalledTimes(1);
      });

      it("should pass disabled prop to scrollToBottomButton via scrollView", async () => {
        await renderScrolledUp({ scrollToBottomButton: { disabled: true } });

        expect(screen.getByTestId("copilot-scroll-to-bottom")).toBeDisabled();
      });
    });

    describe("input props", () => {
      it("should pass onFocus handler to input", () => {
        const handleFocus = vi.fn();
        renderView({ input: { onFocus: handleFocus } });

        fireEvent.focus(screen.getByRole("textbox"));

        expect(handleFocus).toHaveBeenCalled();
      });

      it("should pass autoFocus prop to input", () => {
        renderView({ input: { autoFocus: true } });

        expect(screen.getByRole("textbox")).toHaveFocus();
      });

      it("should allow className prop in input object slot", () => {
        const { container } = renderView({
          input: { className: "custom-input-class" },
        });

        expect(container.querySelector(".cpk-chat-input")).toHaveClass(
          "custom-input-class",
        );
      });
    });

    describe("messageView props", () => {
      it("should allow className prop in messageView object slot", () => {
        const { container } = renderView({
          messageView: { className: "my-custom-class" },
        });

        expect(container.querySelector(".my-custom-class")).not.toBeNull();
      });
    });
  });

  describe("3. Custom Component Slot Override", () => {
    describe("messageView custom component", () => {
      it("should render custom messageView component", () => {
        const CustomMessageView: React.FC<any> = ({ messages }) => (
          <div data-testid="custom-message-view">
            Custom: {messages?.length || 0} messages
          </div>
        );

        renderView({
          messageView: CustomMessageView as typeof CopilotChatMessageView,
        });

        expect(screen.getByTestId("custom-message-view")).toHaveTextContent(
          "Custom: 2 messages",
        );
      });

      it("custom messageView should receive all props including messages", () => {
        const receivedProps: any = {};

        const CustomMessageView: React.FC<any> = (props) => {
          Object.assign(receivedProps, props);
          return <div data-testid="props-receiver">Received</div>;
        };

        renderView({
          isRunning: true,
          messageView: CustomMessageView as typeof CopilotChatMessageView,
        });

        expect(receivedProps.messages).toHaveLength(2);
        expect(receivedProps.isRunning).toBe(true);
      });
    });

    describe("input custom component", () => {
      it("should render custom input component", () => {
        const CustomInput: React.FC<any> = (props) => (
          <div data-testid="custom-input">
            <input
              type="text"
              placeholder="Custom input"
              onChange={(e) => props.onChange?.(e.target.value)}
            />
          </div>
        );

        renderView({ input: CustomInput as typeof CopilotChatInput });

        expect(screen.getByTestId("custom-input")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Custom input")).toBeInTheDocument();
      });

      it("custom input should receive onSubmitMessage callback", () => {
        const submitHandler = vi.fn();

        const CustomInput: React.FC<any> = ({ onSubmitMessage }) => (
          <button
            data-testid="custom-submit"
            onClick={() => onSubmitMessage?.("test message")}
          >
            Submit
          </button>
        );

        renderView({
          input: CustomInput as typeof CopilotChatInput,
          onSubmitMessage: submitHandler,
        });

        fireEvent.click(screen.getByTestId("custom-submit"));
        expect(submitHandler).toHaveBeenCalledWith("test message");
      });
    });

    describe("scrollView custom component", () => {
      it("should render custom scrollView component", () => {
        const CustomScrollView: React.FC<any> = ({ children }) => (
          <div data-testid="custom-scroll">{children}</div>
        );

        renderView({ scrollView: CustomScrollView });

        expect(screen.getByTestId("custom-scroll")).toBeInTheDocument();
      });
    });

    describe("suggestionView custom component", () => {
      it("should render custom suggestionView component", () => {
        const suggestions = [
          { title: "Option A", message: "Do A", isLoading: false },
          { title: "Option B", message: "Do B", isLoading: false },
        ];

        const CustomSuggestionView: React.FC<any> = ({
          suggestions,
          onSelectSuggestion,
        }) => (
          <div data-testid="custom-suggestions">
            {suggestions.map((s: any, i: number) => (
              <button key={i} onClick={() => onSelectSuggestion?.(s, i)}>
                {s.title}
              </button>
            ))}
          </div>
        );

        renderView({
          suggestions,
          suggestionView:
            CustomSuggestionView as typeof CopilotChatSuggestionView,
        });

        const custom = screen.getByTestId("custom-suggestions");
        expect(custom).toHaveTextContent("Option A");
        expect(custom).toHaveTextContent("Option B");
      });
    });

    describe("feather custom component (via scrollView)", () => {
      it("should render custom feather component via scrollView", () => {
        const CustomFeather: React.FC = () => (
          <div data-testid="custom-feather">Custom Feather</div>
        );

        renderView({ scrollView: { feather: CustomFeather } });

        expect(screen.getByTestId("custom-feather")).toHaveTextContent(
          "Custom Feather",
        );
      });
    });

    describe("scrollToBottomButton custom component (nested under scrollView)", () => {
      it("should render custom scrollToBottomButton component via scrollView", async () => {
        const CustomScrollButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = ({ onClick }) => (
          <button data-testid="custom-scroll-btn" onClick={onClick}>
            ⬇️ Go Down
          </button>
        );

        await renderScrolledUp({ scrollToBottomButton: CustomScrollButton });

        expect(screen.getByTestId("custom-scroll-btn")).toHaveTextContent(
          "Go Down",
        );
      });
    });
  });

  describe("4. Recursive Subcomponent Drill-Down", () => {
    describe("messageView -> assistantMessage drill-down", () => {
      it("should allow customizing assistantMessage within messageView", () => {
        const CustomAssistantMessage: React.FC<any> = ({ message }) => (
          <div data-testid="custom-assistant-msg">
            Custom Assistant: {message?.content}
          </div>
        );

        renderView({
          messageView: {
            assistantMessage:
              CustomAssistantMessage as typeof CopilotChatAssistantMessage,
          },
        });

        expect(screen.getByTestId("custom-assistant-msg")).toHaveTextContent(
          "Custom Assistant: Hi there!",
        );
      });
    });

    describe("messageView -> userMessage drill-down", () => {
      it("should allow customizing userMessage within messageView", () => {
        const CustomUserMessage: React.FC<any> = ({ message }) => (
          <div data-testid="custom-user-msg">User said: {message?.content}</div>
        );

        renderView({
          messageView: {
            userMessage: CustomUserMessage as typeof CopilotChatUserMessage,
          },
        });

        expect(screen.getByTestId("custom-user-msg")).toHaveTextContent(
          "User said: Hello",
        );
      });
    });

    describe("messageView -> cursor drill-down", () => {
      it("should allow customizing cursor within messageView", () => {
        const CustomCursor = () => <span data-testid="custom-cursor">|</span>;

        // The cursor shows while a run waits for the reply to the last user
        // message.
        renderView({
          messages: [{ id: "1", role: "user", content: "Hello" }],
          isRunning: true,
          messageView: { cursor: CustomCursor },
        });

        expect(screen.getByTestId("custom-cursor")).toHaveTextContent("|");
      });
    });

    describe("input -> textArea drill-down", () => {
      it("should allow customizing textArea within input", () => {
        const CustomTextArea = React.forwardRef<
          HTMLTextAreaElement,
          React.TextareaHTMLAttributes<HTMLTextAreaElement>
        >((props, ref) => (
          <textarea ref={ref} data-testid="custom-textarea" {...props} />
        ));

        renderView({ input: { textArea: CustomTextArea } });

        expect(screen.getByTestId("custom-textarea")).toBeInTheDocument();
      });
    });

    describe("input -> sendButton drill-down", () => {
      it("should allow customizing sendButton within input", () => {
        const CustomSendButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = ({ onClick, disabled }) => (
          <button
            data-testid="custom-send-btn"
            onClick={onClick}
            disabled={disabled}
          >
            🚀 Send
          </button>
        );

        renderView({ input: { sendButton: CustomSendButton } });

        expect(screen.getByTestId("custom-send-btn")).toHaveTextContent("Send");
      });
    });

    describe("input -> addMenuButton drill-down", () => {
      it("should allow customizing addMenuButton within input", () => {
        const CustomAddMenu: React.FC = () => (
          <button data-testid="custom-add-menu">+ Add</button>
        );

        renderView({ input: { addMenuButton: CustomAddMenu } });

        expect(screen.getByTestId("custom-add-menu")).toHaveTextContent("Add");
      });
    });

    describe("suggestionView -> suggestion drill-down", () => {
      it("should allow customizing suggestion pill within suggestionView", () => {
        const CustomSuggestionPill = React.forwardRef<
          HTMLButtonElement,
          CopilotChatSuggestionPillProps
        >(({ onClick, children }, ref) => (
          <button
            ref={ref}
            data-testid="custom-suggestion-pill"
            onClick={onClick}
          >
            💡 {children}
          </button>
        ));

        renderView({
          suggestions: [
            { title: "Suggestion 1", message: "Do 1", isLoading: false },
          ],
          suggestionView: { suggestion: CustomSuggestionPill },
        });

        expect(screen.getByTestId("custom-suggestion-pill")).toHaveTextContent(
          "💡 Suggestion 1",
        );
      });
    });

    describe("suggestionView -> container drill-down", () => {
      it("should allow customizing container within suggestionView", () => {
        const CustomContainer = React.forwardRef<
          HTMLDivElement,
          React.HTMLAttributes<HTMLDivElement>
        >(({ children, ...props }, ref) => (
          <div ref={ref} data-testid="custom-suggestion-container" {...props}>
            <span>Suggestions:</span>
            {children}
          </div>
        ));

        renderView({
          suggestions: sampleSuggestions,
          suggestionView: { container: CustomContainer },
        });

        expect(
          screen.getByTestId("custom-suggestion-container"),
        ).toHaveTextContent("Suggestions:Test");
      });
    });

    describe("multiple nested overrides simultaneously", () => {
      it("should allow overriding multiple nested slots at once", () => {
        const CustomAssistant: React.FC<any> = ({ message }) => (
          <div data-testid="nested-assistant">A: {message?.content}</div>
        );

        const CustomUser: React.FC<any> = ({ message }) => (
          <div data-testid="nested-user">U: {message?.content}</div>
        );

        const CustomTextArea = React.forwardRef<
          HTMLTextAreaElement,
          React.TextareaHTMLAttributes<HTMLTextAreaElement>
        >((props, ref) => (
          <textarea ref={ref} data-testid="nested-textarea" {...props} />
        ));

        renderView({
          messageView: {
            assistantMessage:
              CustomAssistant as typeof CopilotChatAssistantMessage,
            userMessage: CustomUser as typeof CopilotChatUserMessage,
          },
          input: { textArea: CustomTextArea },
        });

        expect(screen.getByTestId("nested-assistant")).toBeInTheDocument();
        expect(screen.getByTestId("nested-user")).toBeInTheDocument();
        expect(screen.getByTestId("nested-textarea")).toBeInTheDocument();
      });
    });

    describe("three-level deep nesting", () => {
      it("should support messageView -> assistantMessage -> toolbar drill-down", () => {
        const CustomToolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
          children,
        }) => (
          <div data-testid="custom-toolbar">Custom Toolbar: {children}</div>
        );

        renderView({
          messageView: { assistantMessage: { toolbar: CustomToolbar } },
        });

        expect(screen.getByTestId("custom-toolbar")).toHaveTextContent(
          "Custom Toolbar",
        );
      });

      it("should support messageView -> assistantMessage -> copyButton drill-down", () => {
        const CustomCopyButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = ({ onClick }) => (
          <button data-testid="custom-copy-btn" onClick={onClick}>
            📋 Copy
          </button>
        );

        renderView({
          messageView: { assistantMessage: { copyButton: CustomCopyButton } },
        });

        expect(screen.getByTestId("custom-copy-btn")).toHaveTextContent("Copy");
      });

      it("should support messageView -> userMessage -> editButton drill-down", () => {
        const CustomEditButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = ({ onClick }) => (
          <button data-testid="custom-edit-btn" onClick={onClick}>
            ✏️ Edit
          </button>
        );

        // The edit button only renders when the host can edit messages.
        renderView({
          messageView: {
            userMessage: {
              editButton: CustomEditButton,
              onEditMessage: () => {},
            },
          },
        });

        expect(screen.getByTestId("custom-edit-btn")).toHaveTextContent("Edit");
      });
    });
  });

  describe("6. Children Render Function (Composition Pattern)", () => {
    it("should support children render function for full control", () => {
      render(
        <TestWrapper>
          <CopilotChatView messages={sampleMessages}>
            {({ messageView, input }) => (
              <div>
                <div data-testid="messages-area">{messageView}</div>
                <div data-testid="input-area">{input}</div>
              </div>
            )}
          </CopilotChatView>
        </TestWrapper>,
      );

      expect(
        within(screen.getByTestId("messages-area")).getByTestId(
          "copilot-message-list",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("input-area")).getByRole("textbox"),
      ).toBeInTheDocument();
    });

    it("children render function should receive all slot elements", () => {
      let receivedSlots: string[] = [];

      render(
        <TestWrapper>
          <CopilotChatView messages={sampleMessages}>
            {(slots) => {
              receivedSlots = Object.keys(slots);
              return <div data-testid="render-check">Rendered</div>;
            }}
          </CopilotChatView>
        </TestWrapper>,
      );

      expect(receivedSlots.sort()).toEqual([
        "input",
        "messageView",
        "scrollView",
        "suggestionView",
      ]);
    });
  });
});
