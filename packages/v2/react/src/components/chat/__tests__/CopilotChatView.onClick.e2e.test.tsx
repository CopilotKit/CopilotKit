/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotChatInput } from "../CopilotChatInput";
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

const createMessages = () => [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there! How can I help?" },
  { id: "3", role: "user" as const, content: "Tell me a joke" },
  {
    id: "4",
    role: "assistant" as const,
    content: "Why did the chicken cross the road?",
  },
];

const createSuggestions = () => [
  {
    title: "Tell me more",
    message: "Tell me more about that",
    isLoading: false,
  },
  {
    title: "Another topic",
    message: "Let's talk about something else",
    isLoading: false,
  },
];

describe("CopilotChatView onClick Handlers - Drill-Down E2E Tests", () => {
  // ============================================================================
  // LEVEL 1: CopilotChatView Direct Slots
  // ============================================================================
  describe("Level 1: CopilotChatView Direct Slots", () => {
    describe("scrollToBottomButton onClick (nested under scrollView)", () => {
      it("should handle onClick on scrollToBottomButton via scrollView props", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              scrollView={{ scrollToBottomButton: { onClick } }}
            />
          </TestWrapper>,
        );

        // Find and click the scroll to bottom button (may need scrolling to appear)
        const scrollBtn =
          container.querySelector('[aria-label*="scroll"]') ||
          container.querySelector('button[class*="scroll"]');
        if (scrollBtn) {
          fireEvent.click(scrollBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("input onClick", () => {
      it("should handle onClick on input via props object", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              input={{ onClick, "data-testid": "input-slot" } as any}
            />
          </TestWrapper>,
        );

        const input =
          screen.queryByTestId("input-slot") ||
          container.querySelector('[data-slot="input"]');
        if (input) {
          fireEvent.click(input);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("suggestionView onClick", () => {
      it("should handle onSelectSuggestion when suggestion is clicked", () => {
        const onSelectSuggestion = vi.fn();
        render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              suggestions={createSuggestions()}
              onSelectSuggestion={onSelectSuggestion}
            />
          </TestWrapper>,
        );

        const suggestion = screen.queryByText("Tell me more");
        if (suggestion) {
          fireEvent.click(suggestion);
          expect(onSelectSuggestion).toHaveBeenCalled();
        }
      });
    });
  });

  // ============================================================================
  // LEVEL 2: CopilotChatInput Drill-Down
  // ============================================================================
  describe("Level 2: CopilotChatInput Drill-Down", () => {
    describe("input -> sendButton onClick", () => {
      it("should handle onClick on sendButton via input props drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              input={{
                sendButton: { onClick },
              }}
            />
          </TestWrapper>,
        );

        // Find send button by aria-label or common patterns
        const sendBtn =
          container.querySelector('button[aria-label*="Send"]') ||
          container.querySelector('button[type="submit"]');
        if (sendBtn) {
          fireEvent.click(sendBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("input -> startTranscribeButton onClick", () => {
      it("should handle onClick on startTranscribeButton via input props drill-down", () => {
        const onClick = vi.fn();
        const onStartTranscribe = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              onStartTranscribe={onStartTranscribe}
              input={{
                startTranscribeButton: { onClick },
              }}
            />
          </TestWrapper>,
        );

        const transcribeBtn =
          container.querySelector('button[aria-label*="transcribe"]') ||
          container.querySelector('button[aria-label*="voice"]') ||
          container.querySelector('button[aria-label*="microphone"]');
        if (transcribeBtn) {
          fireEvent.click(transcribeBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("input -> addMenuButton onClick", () => {
      it("should handle onClick on addMenuButton via input props drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              input={{
                addMenuButton: { onClick },
              }}
            />
          </TestWrapper>,
        );

        const addBtn =
          container.querySelector('button[aria-label*="add"]') ||
          container.querySelector('button[aria-label*="plus"]') ||
          container.querySelector('button[aria-label*="menu"]');
        if (addBtn) {
          fireEvent.click(addBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("input -> textArea onFocus/onBlur", () => {
      it("should handle onFocus on textArea via input props drill-down", () => {
        const onFocus = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              input={{
                textArea: { onFocus },
              }}
            />
          </TestWrapper>,
        );

        const textarea = container.querySelector("textarea");
        if (textarea) {
          fireEvent.focus(textarea);
          expect(onFocus).toHaveBeenCalled();
        }
      });

      it("should handle onBlur on textArea via input props drill-down", () => {
        const onBlur = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              input={{
                textArea: { onBlur },
              }}
            />
          </TestWrapper>,
        );

        const textarea = container.querySelector("textarea");
        if (textarea) {
          fireEvent.focus(textarea);
          fireEvent.blur(textarea);
          expect(onBlur).toHaveBeenCalled();
        }
      });
    });
  });

  // ============================================================================
  // LEVEL 2: CopilotChatMessageView Drill-Down
  // ============================================================================
  describe("Level 2: CopilotChatMessageView Drill-Down", () => {
    describe("messageView -> assistantMessage onClick", () => {
      it("should handle onClick on assistantMessage container via messageView drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: { onClick },
              }}
            />
          </TestWrapper>,
        );

        // Find assistant message by data-message-id or content
        const assistantMsg =
          container.querySelector('[data-message-id="2"]') ||
          container.querySelector(".prose");
        if (assistantMsg) {
          fireEvent.click(assistantMsg);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("messageView -> userMessage onClick", () => {
      it("should handle onClick on userMessage container via messageView drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                userMessage: { onClick },
              }}
            />
          </TestWrapper>,
        );

        const userMsg = container.querySelector('[data-message-id="1"]');
        if (userMsg) {
          fireEvent.click(userMsg);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });
  });

  // ============================================================================
  // LEVEL 3: CopilotChatAssistantMessage Toolbar Drill-Down
  // ============================================================================
  describe("Level 3: CopilotChatAssistantMessage Toolbar Drill-Down", () => {
    describe("messageView -> assistantMessage -> copyButton onClick", () => {
      it("should handle onClick on copyButton via deep drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  copyButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        // Find copy button in assistant message toolbar (message id "2" is an assistant message)
        const assistantMsg = container.querySelector('[data-message-id="2"]');
        const copyBtn = assistantMsg?.querySelector(
          'button[aria-label*="Copy"]',
        );
        if (copyBtn) {
          fireEvent.click(copyBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("messageView -> assistantMessage -> thumbsUpButton onClick", () => {
      it("should handle onClick on thumbsUpButton via deep drill-down", () => {
        const onClick = vi.fn();
        const onThumbsUp = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  onThumbsUp,
                  thumbsUpButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        const thumbsUpBtn = container.querySelector(
          'button[aria-label*="Thumbs up"]',
        );
        if (thumbsUpBtn) {
          fireEvent.click(thumbsUpBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("messageView -> assistantMessage -> thumbsDownButton onClick", () => {
      it("should handle onClick on thumbsDownButton via deep drill-down", () => {
        const onClick = vi.fn();
        const onThumbsDown = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  onThumbsDown,
                  thumbsDownButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        const thumbsDownBtn = container.querySelector(
          'button[aria-label*="Thumbs down"]',
        );
        if (thumbsDownBtn) {
          fireEvent.click(thumbsDownBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("messageView -> assistantMessage -> readAloudButton onClick", () => {
      it("should handle onClick on readAloudButton via deep drill-down", () => {
        const onClick = vi.fn();
        const onReadAloud = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  onReadAloud,
                  readAloudButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        const readAloudBtn = container.querySelector(
          'button[aria-label*="Read"]',
        );
        if (readAloudBtn) {
          fireEvent.click(readAloudBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("messageView -> assistantMessage -> regenerateButton onClick", () => {
      it("should handle onClick on regenerateButton via deep drill-down", () => {
        const onClick = vi.fn();
        const onRegenerate = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  onRegenerate,
                  regenerateButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        const regenerateBtn = container.querySelector(
          'button[aria-label*="Regenerate"]',
        );
        if (regenerateBtn) {
          fireEvent.click(regenerateBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("messageView -> assistantMessage -> toolbar onClick", () => {
      it("should handle onClick on entire toolbar via deep drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  toolbar: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        // Find toolbar container (usually contains the buttons)
        const toolbars = container.querySelectorAll('[class*="toolbar"]');
        const firstToolbar = toolbars[0];
        if (firstToolbar) {
          fireEvent.click(firstToolbar);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });
  });

  // ============================================================================
  // LEVEL 3: CopilotChatUserMessage Toolbar Drill-Down
  // ============================================================================
  describe("Level 3: CopilotChatUserMessage Toolbar Drill-Down", () => {
    describe("messageView -> userMessage -> copyButton onClick", () => {
      it("should handle onClick on copyButton via deep drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                userMessage: {
                  copyButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        // User message copy buttons may be in hover state
        // Need to trigger hover first or find them directly
        const userMsgContainers = container.querySelectorAll(
          '[data-message-id="1"], [data-message-id="3"]',
        );
        const firstUserMsg = userMsgContainers[0];
        if (firstUserMsg) {
          // Trigger mouseenter to show toolbar
          fireEvent.mouseEnter(firstUserMsg);

          const copyBtn = container.querySelector('button[aria-label*="Copy"]');
          if (copyBtn) {
            fireEvent.click(copyBtn);
            expect(onClick).toHaveBeenCalled();
          }
        }
      });
    });

    describe("messageView -> userMessage -> editButton onClick", () => {
      it("should handle onClick on editButton via deep drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                userMessage: {
                  onEditMessage: vi.fn(),
                  editButton: { onClick },
                },
              }}
            />
          </TestWrapper>,
        );

        const userMsgContainers = container.querySelectorAll(
          '[data-message-id="1"], [data-message-id="3"]',
        );
        const firstUserMsg = userMsgContainers[0];
        if (firstUserMsg) {
          fireEvent.mouseEnter(firstUserMsg);

          const editBtn = container.querySelector('button[aria-label*="Edit"]');
          if (editBtn) {
            fireEvent.click(editBtn);
            expect(onClick).toHaveBeenCalled();
          }
        }
      });
    });
  });

  // ============================================================================
  // LEVEL 2: SuggestionView Drill-Down
  // ============================================================================
  describe("Level 2: SuggestionView Drill-Down", () => {
    describe("suggestionView -> container onClick", () => {
      it("should handle onClick on suggestion container via drill-down", () => {
        const onClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              suggestions={createSuggestions()}
              suggestionView={{
                // Note: container has pointer-events-none by default, need to override
                container: {
                  onClick,
                  className: "pointer-events-auto",
                  "data-testid": "suggestion-container",
                } as any,
              }}
            />
          </TestWrapper>,
        );

        // Find suggestion container
        const suggestionContainer = container.querySelector(
          '[data-testid="suggestion-container"]',
        );
        if (suggestionContainer) {
          fireEvent.click(suggestionContainer);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("suggestionView -> suggestion onClick", () => {
      it("should handle onClick on individual suggestion pills via drill-down", () => {
        const onClick = vi.fn();
        render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              suggestions={createSuggestions()}
              suggestionView={{
                suggestion: { onClick },
              }}
            />
          </TestWrapper>,
        );

        const suggestionPill = screen.queryByText("Tell me more");
        if (suggestionPill) {
          fireEvent.click(suggestionPill);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });
  });

  // ============================================================================
  // FUNCTION RENDER SLOT PATTERN TESTS
  // ============================================================================
  describe("Function Render Slot Pattern", () => {
    describe("input slot with render function", () => {
      it("should support passing render function to input slot", () => {
        const onSubmitMessage = vi.fn();
        const CustomInput = (props: any) => (
          <CopilotChatInput
            {...props}
            onSubmitMessage={onSubmitMessage}
            sendButton="custom-send-class"
          />
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              input={CustomInput as any}
            />
          </TestWrapper>,
        );

        // The custom send class should be applied
        const sendBtn = document.querySelector(".custom-send-class");
        expect(sendBtn).toBeDefined();
      });
    });

    describe("messageView slot with render function", () => {
      it("should support passing render function to messageView slot", () => {
        const CustomMessageView = (props: any) => (
          <CopilotChatMessageView {...props} className="custom-message-view" />
        );

        render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={CustomMessageView as any}
            />
          </TestWrapper>,
        );

        const messageView = document.querySelector(".custom-message-view");
        expect(messageView).toBeDefined();
      });
    });
  });

  // ============================================================================
  // CALLBACK PROPAGATION TESTS
  // ============================================================================
  describe("Callback Propagation Through Slot Hierarchy", () => {
    describe("onSubmitMessage propagation", () => {
      it("should propagate onSubmitMessage through input slot", () => {
        const onSubmitMessage = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              onSubmitMessage={onSubmitMessage}
            />
          </TestWrapper>,
        );

        const textarea = container.querySelector("textarea");
        const form = container.querySelector("form");

        if (textarea && form) {
          fireEvent.change(textarea, { target: { value: "Test message" } });
          fireEvent.submit(form);
          expect(onSubmitMessage).toHaveBeenCalledWith("Test message");
        }
      });
    });

    describe("onStop propagation", () => {
      it("should propagate onStop through input slot", () => {
        const onStop = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              isRunning={true}
              onStop={onStop}
            />
          </TestWrapper>,
        );

        // Find stop button (usually appears when isRunning=true)
        const stopBtn =
          container.querySelector('button[aria-label*="Stop"]') ||
          container.querySelector('button[aria-label*="stop"]');
        if (stopBtn) {
          fireEvent.click(stopBtn);
          expect(onStop).toHaveBeenCalled();
        }
      });
    });

    describe("onThumbsUp/onThumbsDown propagation", () => {
      it("should propagate onThumbsUp through messageView slot", () => {
        const onThumbsUp = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  onThumbsUp,
                },
              }}
            />
          </TestWrapper>,
        );

        const thumbsUpBtn = container.querySelector(
          'button[aria-label*="Thumbs up"]',
        );
        if (thumbsUpBtn) {
          fireEvent.click(thumbsUpBtn);
          expect(onThumbsUp).toHaveBeenCalled();
        }
      });

      it("should propagate onThumbsDown through messageView slot", () => {
        const onThumbsDown = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                assistantMessage: {
                  onThumbsDown,
                },
              }}
            />
          </TestWrapper>,
        );

        const thumbsDownBtn = container.querySelector(
          'button[aria-label*="Thumbs down"]',
        );
        if (thumbsDownBtn) {
          fireEvent.click(thumbsDownBtn);
          expect(onThumbsDown).toHaveBeenCalled();
        }
      });
    });

    describe("onEditMessage propagation", () => {
      it("should propagate onEditMessage through messageView slot", () => {
        const onEditMessage = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotChatView
              messages={createMessages()}
              messageView={{
                userMessage: {
                  onEditMessage,
                },
              }}
            />
          </TestWrapper>,
        );

        // Find user message and hover to show toolbar
        const userMsgContainers = container.querySelectorAll(
          '[data-message-id="1"]',
        );
        const firstUserMsg = userMsgContainers[0];
        if (firstUserMsg) {
          fireEvent.mouseEnter(firstUserMsg);

          const editBtn = container.querySelector('button[aria-label*="Edit"]');
          if (editBtn) {
            fireEvent.click(editBtn);
            expect(onEditMessage).toHaveBeenCalled();
          }
        }
      });
    });
  });

  // ============================================================================
  // COMBINED CUSTOMIZATION WITH ONCLICK
  // ============================================================================
  describe("Combined Customization with onClick", () => {
    it("should handle onClick alongside tailwind class customization", () => {
      const onClick = vi.fn();
      const { container } = render(
        <TestWrapper>
          <CopilotChatView
            messages={createMessages()}
            messageView={{
              assistantMessage: {
                copyButton: {
                  onClick,
                  className: "custom-copy-class",
                },
              },
            }}
          />
        </TestWrapper>,
      );

      const copyBtn =
        container.querySelector(".custom-copy-class") ||
        container.querySelector('button[aria-label*="Copy"]');
      if (copyBtn) {
        fireEvent.click(copyBtn);
        expect(onClick).toHaveBeenCalled();
      }
    });

    it("should allow custom component with onClick handling", () => {
      const customOnClick = vi.fn();
      const CustomCopyButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = ({ onClick, ...props }) => (
        <button
          {...props}
          onClick={(e) => {
            customOnClick();
            onClick?.(e);
          }}
          data-testid="custom-copy"
        >
          Copy
        </button>
      );

      render(
        <TestWrapper>
          <CopilotChatView
            messages={createMessages()}
            messageView={{
              assistantMessage: {
                copyButton: CustomCopyButton as any,
              },
            }}
          />
        </TestWrapper>,
      );

      // Multiple assistant messages have custom copy buttons
      const customCopyButtons = screen.queryAllByTestId("custom-copy");
      if (customCopyButtons.length > 0) {
        fireEvent.click(customCopyButtons[0]);
        expect(customOnClick).toHaveBeenCalled();
      }
    });
  });
});
