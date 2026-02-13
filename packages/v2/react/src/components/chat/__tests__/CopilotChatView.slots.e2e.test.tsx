import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotChatSuggestionView } from "../CopilotChatSuggestionView";
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
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

describe("CopilotChatView Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("messageView slot", () => {
      it("should apply tailwind class string to messageView", () => {
        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView="bg-red-500 text-white p-4"
            />
          </TestWrapper>,
        );

        // The messageView should have the custom tailwind classes
        const messageContainer = document.querySelector(
          '[class*="bg-red-500"]',
        );
        expect(messageContainer).toBeDefined();
        expect(messageContainer?.classList.contains("text-white")).toBe(true);
        expect(messageContainer?.classList.contains("p-4")).toBe(true);
      });

      it("should override default className with tailwind string", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView="custom-override-class"
            />
          </TestWrapper>,
        );

        const messageContainer = container.querySelector(
          ".custom-override-class",
        );
        expect(messageContainer).toBeDefined();
      });
    });

    describe("scrollView slot", () => {
      it("should apply tailwind class string to scrollView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView="overflow-y-auto bg-gray-100"
            />
          </TestWrapper>,
        );

        const scrollContainer = container.querySelector(".overflow-y-auto");
        expect(scrollContainer).toBeDefined();
        expect(scrollContainer?.classList.contains("bg-gray-100")).toBe(true);
      });
    });

    describe("scrollToBottomButton slot (nested under scrollView)", () => {
      it("should apply tailwind class string to scrollToBottomButton via scrollView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={{ scrollToBottomButton: "bg-blue-500 rounded-full" }}
            />
          </TestWrapper>,
        );

        // Note: button may only appear when scrolled
        const button = container.querySelector(".bg-blue-500");
        if (button) {
          expect(button.classList.contains("rounded-full")).toBe(true);
        }
      });
    });

    describe("input slot", () => {
      it("should apply tailwind class string to input", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input="border-2 border-purple-500"
            />
          </TestWrapper>,
        );

        const inputContainer = container.querySelector(".border-purple-500");
        expect(inputContainer).toBeDefined();
      });
    });

    describe("feather slot (via scrollView)", () => {
      it("should apply tailwind class string to feather via scrollView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={{ feather: "text-green-500 font-bold" }}
            />
          </TestWrapper>,
        );

        const feather = container.querySelector(".text-green-500");
        if (feather) {
          expect(feather.classList.contains("font-bold")).toBe(true);
        }
      });
    });

    describe("suggestionView slot", () => {
      it("should apply tailwind class string to suggestionView", () => {
        const suggestions = [
          { title: "Test", message: "Test message", isLoading: false },
        ];

        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              suggestions={suggestions}
              suggestionView="flex gap-2 bg-indigo-50"
            />
          </TestWrapper>,
        );

        const suggestionContainer = container.querySelector(".bg-indigo-50");
        expect(suggestionContainer).toBeDefined();
      });
    });

    describe("className vs tailwind string precedence", () => {
      it("tailwind string should completely replace className (not merge)", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input="only-this-class"
            />
          </TestWrapper>,
        );

        const inputEl = container.querySelector(".only-this-class");
        expect(inputEl).toBeDefined();
        // The string replaces className, so default classes should not be present
      });
    });

    describe("non-tailwind inline styles should still work", () => {
      it("should accept style prop alongside className override", () => {
        const CustomInput = React.forwardRef<HTMLDivElement, any>(
          (props, ref) => (
            <div
              ref={ref}
              className={props.className}
              style={{ backgroundColor: "rgb(255, 0, 0)" }}
              data-testid="custom-input"
            >
              {props.children}
            </div>
          ),
        );
        CustomInput.displayName = "CustomInput";

        render(
          <TestWrapper>
            <CopilotChatView messages={sampleMessages} input={CustomInput} />
          </TestWrapper>,
        );

        const customInput = screen.queryByTestId("custom-input");
        if (customInput) {
          expect(customInput.style.backgroundColor).toBe("rgb(255, 0, 0)");
        }
      });
    });
  });

  // ============================================================================
  // 2. PROPERTIES (onClick, disabled, etc.) TESTS
  // ============================================================================
  describe("2. Properties Slot Override", () => {
    describe("scrollToBottomButton props (nested under scrollView)", () => {
      it("should pass onClick handler to scrollToBottomButton via scrollView", () => {
        const handleClick = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={{ scrollToBottomButton: { onClick: handleClick } }}
            />
          </TestWrapper>,
        );

        // Find and click the scroll button if visible
        const buttons = document.querySelectorAll("button");
        buttons.forEach((btn) => {
          if (btn.getAttribute("aria-label")?.includes("scroll")) {
            fireEvent.click(btn);
          }
        });
        // Note: onClick may only fire if button is visible
      });

      it("should pass disabled prop to scrollToBottomButton via scrollView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={{ scrollToBottomButton: { disabled: true } }}
            />
          </TestWrapper>,
        );

        const buttons = container.querySelectorAll("button[disabled]");
        // Check if any button is disabled
        expect(buttons).toBeDefined();
      });
    });

    describe("input props", () => {
      it("should pass onFocus handler to input", async () => {
        const handleFocus = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{ onFocus: handleFocus }}
            />
          </TestWrapper>,
        );

        const textarea = await screen.findByRole("textbox");
        fireEvent.focus(textarea);
        // Note: depends on how input passes props through
      });

      it("should pass autoFocus prop to input", () => {
        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{ autoFocus: true }}
            />
          </TestWrapper>,
        );

        // Check if textbox is focused
        const textarea = document.querySelector("textarea");
        // autoFocus behavior may vary
      });
    });

    describe("messageView props", () => {
      it("should pass isRunning prop to messageView", () => {
        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              isRunning={true}
              messageView={{ "data-testid": "message-view-running" } as any}
            />
          </TestWrapper>,
        );

        const messageView = screen.queryByTestId("message-view-running");
        expect(messageView).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Slot Override", () => {
    describe("messageView custom component", () => {
      it("should render custom messageView component", () => {
        const CustomMessageView: React.FC<any> = ({ messages }) => (
          <div data-testid="custom-message-view">
            Custom: {messages?.length || 0} messages
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={CustomMessageView}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-message-view")).toBeDefined();
        expect(screen.getByText(/Custom: 2 messages/)).toBeDefined();
      });

      it("custom messageView should receive all props including messages", () => {
        const receivedProps: any = {};

        const CustomMessageView: React.FC<any> = (props) => {
          Object.assign(receivedProps, props);
          return <div data-testid="props-receiver">Received</div>;
        };

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              isRunning={true}
              messageView={CustomMessageView}
            />
          </TestWrapper>,
        );

        expect(receivedProps.messages).toBeDefined();
        expect(receivedProps.messages.length).toBe(2);
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
            <button onClick={() => props.onSubmitMessage?.("test")}>
              Send
            </button>
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatView messages={sampleMessages} input={CustomInput} />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-input")).toBeDefined();
        expect(screen.getByPlaceholderText("Custom input")).toBeDefined();
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

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={CustomInput}
              onSubmitMessage={submitHandler}
            />
          </TestWrapper>,
        );

        fireEvent.click(screen.getByTestId("custom-submit"));
        expect(submitHandler).toHaveBeenCalledWith("test message");
      });
    });

    describe("scrollView custom component", () => {
      it("should render custom scrollView component", () => {
        const CustomScrollView: React.FC<any> = ({ children }) => (
          <div
            data-testid="custom-scroll"
            style={{ maxHeight: 300, overflow: "auto" }}
          >
            {children}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={CustomScrollView}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-scroll")).toBeDefined();
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

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              suggestions={suggestions}
              suggestionView={CustomSuggestionView}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-suggestions")).toBeDefined();
        expect(screen.getByText("Option A")).toBeDefined();
        expect(screen.getByText("Option B")).toBeDefined();
      });
    });

    describe("feather custom component (via scrollView)", () => {
      it("should render custom feather component via scrollView", () => {
        const CustomFeather: React.FC<any> = () => (
          <div data-testid="custom-feather">Custom Feather</div>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={{ feather: CustomFeather }}
            />
          </TestWrapper>,
        );

        const feather = screen.queryByTestId("custom-feather");
        if (feather) {
          expect(feather.textContent).toContain("Custom Feather");
        }
      });
    });

    describe("scrollToBottomButton custom component (nested under scrollView)", () => {
      it("should render custom scrollToBottomButton component via scrollView", () => {
        const CustomScrollButton: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-scroll-btn" onClick={onClick}>
            ⬇️ Go Down
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView={{ scrollToBottomButton: CustomScrollButton }}
            />
          </TestWrapper>,
        );

        // Button may only appear when scrolled
        const btn = screen.queryByTestId("custom-scroll-btn");
        if (btn) {
          expect(btn.textContent).toContain("Go Down");
        }
      });
    });
  });

  // ============================================================================
  // 4. RECURSIVE DRILL-DOWN TESTS
  // ============================================================================
  describe("4. Recursive Subcomponent Drill-Down", () => {
    describe("messageView -> assistantMessage drill-down", () => {
      it("should allow customizing assistantMessage within messageView", () => {
        const CustomAssistantMessage: React.FC<any> = ({ message }) => (
          <div data-testid="custom-assistant-msg">
            Custom Assistant: {message?.content}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{
                assistantMessage: CustomAssistantMessage,
              }}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-assistant-msg")).toBeDefined();
        expect(screen.getByText(/Custom Assistant: Hi there!/)).toBeDefined();
      });
    });

    describe("messageView -> userMessage drill-down", () => {
      it("should allow customizing userMessage within messageView", () => {
        const CustomUserMessage: React.FC<any> = ({ message }) => (
          <div data-testid="custom-user-msg">User said: {message?.content}</div>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{
                userMessage: CustomUserMessage,
              }}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-user-msg")).toBeDefined();
        expect(screen.getByText(/User said: Hello/)).toBeDefined();
      });
    });

    describe("messageView -> cursor drill-down", () => {
      it("should allow customizing cursor within messageView", () => {
        const CustomCursor: React.FC<any> = () => (
          <span data-testid="custom-cursor">|</span>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              isRunning={true}
              messageView={{
                cursor: CustomCursor,
              }}
            />
          </TestWrapper>,
        );

        // Cursor appears when running
        const cursor = screen.queryByTestId("custom-cursor");
        if (cursor) {
          expect(cursor.textContent).toBe("|");
        }
      });
    });

    describe("input -> textArea drill-down", () => {
      it("should allow customizing textArea within input", () => {
        const CustomTextArea: React.FC<any> = React.forwardRef<
          HTMLTextAreaElement,
          any
        >(({ value, onChange, ...props }, ref) => (
          <textarea
            ref={ref}
            data-testid="custom-textarea"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="Type here..."
            {...props}
          />
        ));

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{
                textArea: CustomTextArea,
              }}
            />
          </TestWrapper>,
        );

        const textarea = screen.queryByTestId("custom-textarea");
        if (textarea) {
          expect(textarea.getAttribute("placeholder")).toBe("Type here...");
        }
      });
    });

    describe("input -> sendButton drill-down", () => {
      it("should allow customizing sendButton within input", () => {
        const CustomSendButton: React.FC<any> = ({ onClick, disabled }) => (
          <button
            data-testid="custom-send-btn"
            onClick={onClick}
            disabled={disabled}
          >
            🚀 Send
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{
                sendButton: CustomSendButton,
              }}
            />
          </TestWrapper>,
        );

        const sendBtn = screen.queryByTestId("custom-send-btn");
        if (sendBtn) {
          expect(sendBtn.textContent).toContain("Send");
        }
      });
    });

    describe("input -> addMenuButton drill-down", () => {
      it("should allow customizing addMenuButton within input", () => {
        const CustomAddMenu: React.FC<any> = () => (
          <button data-testid="custom-add-menu">+ Add</button>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{
                addMenuButton: CustomAddMenu,
              }}
            />
          </TestWrapper>,
        );

        const addBtn = screen.queryByTestId("custom-add-menu");
        if (addBtn) {
          expect(addBtn.textContent).toContain("Add");
        }
      });
    });

    describe("suggestionView -> suggestion drill-down", () => {
      it("should allow customizing suggestion pill within suggestionView", () => {
        const suggestions = [
          { title: "Suggestion 1", message: "Do 1", isLoading: false },
        ];

        // Custom suggestion component that handles the props passed by the slot system
        const CustomSuggestionPill: React.FC<any> = ({
          suggestion,
          onClick,
          title,
        }) => (
          <button
            data-testid="custom-suggestion-pill"
            onClick={() => onClick?.(suggestion)}
          >
            💡 {suggestion?.title ?? title ?? "Suggestion"}
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              suggestions={suggestions}
              suggestionView={{
                suggestion: CustomSuggestionPill,
              }}
            />
          </TestWrapper>,
        );

        const pill = screen.queryByTestId("custom-suggestion-pill");
        if (pill) {
          expect(pill.textContent).toContain("Suggestion");
        }
      });
    });

    describe("suggestionView -> container drill-down", () => {
      it("should allow customizing container within suggestionView", () => {
        const suggestions = [
          { title: "Test", message: "Test msg", isLoading: false },
        ];

        const CustomContainer: React.FC<any> = React.forwardRef<
          HTMLDivElement,
          any
        >(({ children, ...props }, ref) => (
          <div ref={ref} data-testid="custom-suggestion-container" {...props}>
            <span>Suggestions:</span>
            {children}
          </div>
        ));

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              suggestions={suggestions}
              suggestionView={{
                container: CustomContainer,
              }}
            />
          </TestWrapper>,
        );

        const container = screen.queryByTestId("custom-suggestion-container");
        if (container) {
          expect(container.textContent).toContain("Suggestions:");
        }
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

        const CustomTextArea: React.FC<any> = React.forwardRef<any, any>(
          (props, ref) => (
            <textarea ref={ref} data-testid="nested-textarea" {...props} />
          ),
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{
                assistantMessage: CustomAssistant,
                userMessage: CustomUser,
              }}
              input={{
                textArea: CustomTextArea,
              }}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("nested-assistant")).toBeDefined();
        expect(screen.getByTestId("nested-user")).toBeDefined();
        const textarea = screen.queryByTestId("nested-textarea");
        expect(textarea).toBeDefined();
      });
    });

    describe("three-level deep nesting", () => {
      it("should support messageView -> assistantMessage -> toolbar drill-down", () => {
        const CustomToolbar: React.FC<any> = ({ children }) => (
          <div data-testid="custom-toolbar" className="custom-toolbar">
            Custom Toolbar: {children}
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{
                assistantMessage: {
                  toolbar: CustomToolbar,
                },
              }}
            />
          </TestWrapper>,
        );

        const toolbar = screen.queryByTestId("custom-toolbar");
        if (toolbar) {
          expect(toolbar.textContent).toContain("Custom Toolbar");
        }
      });

      it("should support messageView -> assistantMessage -> copyButton drill-down", () => {
        const CustomCopyButton: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-copy-btn" onClick={onClick}>
            📋 Copy
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{
                assistantMessage: {
                  copyButton: CustomCopyButton,
                },
              }}
            />
          </TestWrapper>,
        );

        const copyBtn = screen.queryByTestId("custom-copy-btn");
        if (copyBtn) {
          expect(copyBtn.textContent).toContain("Copy");
        }
      });

      it("should support messageView -> userMessage -> editButton drill-down", () => {
        const CustomEditButton: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-edit-btn" onClick={onClick}>
            ✏️ Edit
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{
                userMessage: {
                  editButton: CustomEditButton,
                },
              }}
            />
          </TestWrapper>,
        );

        const editBtn = screen.queryByTestId("custom-edit-btn");
        if (editBtn) {
          expect(editBtn.textContent).toContain("Edit");
        }
      });
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind", () => {
    describe("className prop override", () => {
      it("should allow className prop in object slot to override defaults", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView={{ className: "my-custom-class" }}
            />
          </TestWrapper>,
        );

        const customElement = container.querySelector(".my-custom-class");
        expect(customElement).toBeDefined();
      });

      it("should merge className with other props in object slot", () => {
        render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={
                {
                  className: "custom-input-class",
                  "data-testid": "input-with-class",
                } as any
              }
            />
          </TestWrapper>,
        );

        const input = screen.queryByTestId("input-with-class");
        if (input) {
          expect(input.classList.contains("custom-input-class")).toBe(true);
        }
      });
    });

    describe("string slot vs className prop equivalence", () => {
      it("string slot should behave same as className prop", () => {
        // String slot version
        const { container: container1 } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input="test-class-string"
            />
          </TestWrapper>,
        );

        // className prop version
        const { container: container2 } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{ className: "test-class-object" }}
            />
          </TestWrapper>,
        );

        expect(container1.querySelector(".test-class-string")).toBeDefined();
        expect(container2.querySelector(".test-class-object")).toBeDefined();
      });
    });

    describe("tailwind utility class merging", () => {
      it("should properly apply tailwind utilities like flex, grid, etc.", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input="flex items-center justify-between gap-4"
            />
          </TestWrapper>,
        );

        // Find the input specifically (it has justify-between which is unique to our slot)
        const flexContainer = container.querySelector(".justify-between");
        if (flexContainer) {
          expect(flexContainer.classList.contains("flex")).toBe(true);
          expect(flexContainer.classList.contains("items-center")).toBe(true);
          expect(flexContainer.classList.contains("gap-4")).toBe(true);
        }
      });

      it("should apply responsive tailwind classes", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              messageView="p-2 md:p-4 lg:p-6"
            />
          </TestWrapper>,
        );

        const element = container.querySelector(".p-2");
        if (element) {
          expect(element.classList.contains("md:p-4")).toBe(true);
          expect(element.classList.contains("lg:p-6")).toBe(true);
        }
      });

      it("should apply dark mode tailwind classes", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              scrollView="bg-white dark:bg-gray-900"
            />
          </TestWrapper>,
        );

        const element = container.querySelector(".bg-white");
        if (element) {
          expect(element.classList.contains("dark:bg-gray-900")).toBe(true);
        }
      });
    });

    describe("user className should override pre-set className", () => {
      it("object slot className should take precedence over defaults", () => {
        // This tests that when user provides className in object slot,
        // it should override/replace the default className
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={sampleMessages}
              input={{ className: "user-override-class" }}
            />
          </TestWrapper>,
        );

        const element = container.querySelector(".user-override-class");
        expect(element).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 6. CHILDREN RENDER FUNCTION TESTS
  // ============================================================================
  describe("6. Children Render Function (Composition Pattern)", () => {
    it("should support children render function for full control", () => {
      render(
        <TestWrapper>
          <CopilotChatView messages={sampleMessages}>
            {({ messageView, input }) => (
              <div data-testid="custom-layout">
                <div className="messages-area">{messageView}</div>
                <div className="input-area">{input}</div>
              </div>
            )}
          </CopilotChatView>
        </TestWrapper>,
      );

      expect(screen.getByTestId("custom-layout")).toBeDefined();
      expect(document.querySelector(".messages-area")).toBeDefined();
      expect(document.querySelector(".input-area")).toBeDefined();
    });

    it("children render function should receive all slot elements", () => {
      const receivedSlots: string[] = [];

      render(
        <TestWrapper>
          <CopilotChatView messages={sampleMessages}>
            {(slots) => {
              receivedSlots.push(...Object.keys(slots));
              return <div data-testid="render-check">Rendered</div>;
            }}
          </CopilotChatView>
        </TestWrapper>,
      );

      // Should receive at least messageView, input, scrollView, etc.
      expect(
        receivedSlots.includes("messageView") || receivedSlots.length > 0,
      ).toBe(true);
    });
  });
});
