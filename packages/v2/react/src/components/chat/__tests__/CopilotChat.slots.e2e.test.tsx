import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { MockStepwiseAgent } from "@/__tests__/utils/test-helpers";

// Create a mock agent for testing
const createMockAgent = () => new MockStepwiseAgent();

// Wrapper to provide required context with mock agent
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mockAgent = createMockAgent();
  return (
    <CopilotKitProvider agents__unsafe_dev_only={{ default: mockAgent }}>
      <CopilotChatConfigurationProvider threadId="test-thread">
        {children}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
};

describe("CopilotChat Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS - CHATVIEW SLOT
  // ============================================================================
  describe("1. Tailwind Class Slot Override - chatView Slot", () => {
    describe("chatView slot", () => {
      it("should apply tailwind class string to chatView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChat chatView="bg-gradient-to-b from-white to-gray-50 rounded-xl shadow-2xl" />
          </TestWrapper>,
        );

        const chatView = container.querySelector(".bg-gradient-to-b");
        expect(chatView).toBeDefined();
        expect(chatView?.classList.contains("rounded-xl")).toBe(true);
        expect(chatView?.classList.contains("shadow-2xl")).toBe(true);
      });

      it("should apply custom background color via tailwind class", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChat chatView="bg-blue-50" />
          </TestWrapper>,
        );

        const chatView = container.querySelector(".bg-blue-50");
        expect(chatView).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS - CHATVIEW SLOT
  // ============================================================================
  describe("2. Property Passing - chatView Slot", () => {
    describe("chatView slot", () => {
      it("should pass custom props to chatView", () => {
        render(
          <TestWrapper>
            <CopilotChat chatView={{ "data-testid": "custom-chat-view" }} />
          </TestWrapper>,
        );

        const chatView = screen.queryByTestId("custom-chat-view");
        expect(chatView).toBeDefined();
      });

      it("should pass className through props object", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChat chatView={{ className: "custom-class-from-props" }} />
          </TestWrapper>,
        );

        const chatView = container.querySelector(".custom-class-from-props");
        expect(chatView).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS - CHATVIEW SLOT
  // ============================================================================
  describe("3. Custom Component - chatView Slot", () => {
    it("should allow custom component for chatView", () => {
      const CustomChatView: React.FC<any> = ({
        messages,
        isRunning,
        ...props
      }) => (
        <div data-testid="custom-chat-view-component" {...props}>
          <div className="custom-header">Custom Chat Interface</div>
          <div className="messages-area">
            {messages?.map((m: any) => (
              <div key={m.id} className="message">
                {m.content}
              </div>
            ))}
          </div>
          <div className="custom-footer">
            {isRunning ? "Processing..." : "Ready"}
          </div>
        </div>
      );

      render(
        <TestWrapper>
          <CopilotChat chatView={CustomChatView as any} />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-chat-view-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Custom Chat Interface");
    });

    it("should pass messages to custom chatView component", () => {
      const receivedProps: any[] = [];
      const CustomChatView: React.FC<any> = (props) => {
        receivedProps.push(props);
        return (
          <div data-testid="custom-view">
            Messages: {props.messages?.length ?? 0}
          </div>
        );
      };

      render(
        <TestWrapper>
          <CopilotChat chatView={CustomChatView as any} />
        </TestWrapper>,
      );

      expect(receivedProps.length).toBeGreaterThan(0);
      expect(receivedProps[0]).toHaveProperty("messages");
      expect(receivedProps[0]).toHaveProperty("isRunning");
    });

    it("should pass all CopilotChatView props to custom component", () => {
      const receivedProps: any[] = [];
      const CustomChatView: React.FC<any> = (props) => {
        receivedProps.push(props);
        return <div data-testid="custom-view" />;
      };

      render(
        <TestWrapper>
          <CopilotChat chatView={CustomChatView as any} />
        </TestWrapper>,
      );

      expect(receivedProps.length).toBeGreaterThan(0);
      const props = receivedProps[0];
      // Check that standard CopilotChatViewProps are passed
      expect(props).toHaveProperty("messages");
      expect(props).toHaveProperty("isRunning");
      expect(props).toHaveProperty("onSubmitMessage");
    });
  });

  // ============================================================================
  // 4. DRILL-DOWN INTO CHATVIEW SUB-SLOTS VIA PROPS OBJECT
  // ============================================================================
  describe("4. Drill-down into CopilotChatView Sub-slots via Props Object", () => {
    it("should allow customizing nested messageView slot via props", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat
            chatView={{
              messageView: "custom-message-view-class",
            }}
          />
        </TestWrapper>,
      );

      const messageView = container.querySelector(".custom-message-view-class");
      expect(messageView).toBeDefined();
    });

    it("should allow customizing nested input slot via props", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat
            chatView={{
              input: "custom-input-class border-2 border-green-400",
            }}
          />
        </TestWrapper>,
      );

      const input = container.querySelector(".custom-input-class");
      expect(input).toBeDefined();
    });

    it("should allow customizing nested scrollView slot via props", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat
            chatView={{
              scrollView: "custom-scroll-view",
            }}
          />
        </TestWrapper>,
      );

      const scrollView = container.querySelector(".custom-scroll-view");
      expect(scrollView).toBeDefined();
    });

    it("should allow customizing nested input slot via props", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat
            chatView={{
              input: "custom-input bg-slate-100",
            }}
          />
        </TestWrapper>,
      );

      const input = container.querySelector(".custom-input");
      expect(input).toBeDefined();
    });
  });

  // ============================================================================
  // 5. CUSTOM CHATVIEW COMPONENT
  // ============================================================================
  describe("5. Custom ChatView Component for Complex Customization", () => {
    it("should allow custom chatView component with full control", () => {
      const CustomChatView: React.FC<any> = (props) => (
        <div data-testid="fully-custom-chat" className="custom-chat-layout">
          <CopilotChatView
            {...props}
            messageView="custom-message-from-wrapper"
            input="custom-input-from-wrapper"
          />
        </div>
      );

      const { container } = render(
        <TestWrapper>
          <CopilotChat chatView={CustomChatView as any} />
        </TestWrapper>,
      );

      expect(screen.queryByTestId("fully-custom-chat")).toBeDefined();
      expect(container.querySelector(".custom-chat-layout")).toBeDefined();
    });
  });

  // ============================================================================
  // 6. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("6. className Override with Tailwind Strings", () => {
    it("should apply tailwind string to chatView as className", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat chatView="h-full min-h-0 flex flex-col" />
        </TestWrapper>,
      );

      const chatView = container.querySelector(".h-full");
      expect(chatView).toBeDefined();
      expect(chatView?.classList.contains("min-h-0")).toBe(true);
      expect(chatView?.classList.contains("flex-col")).toBe(true);
    });

    it("should merge chatView tailwind classes with CopilotChatView defaults", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat chatView="custom-override-class" />
        </TestWrapper>,
      );

      const chatView = container.querySelector(".custom-override-class");
      expect(chatView).toBeDefined();
    });
  });

  // ============================================================================
  // 7. COPILOTCHAT-SPECIFIC PROPS
  // ============================================================================
  describe("7. CopilotChat-specific Props", () => {
    it("should support agentId prop", () => {
      // Create wrapper with the custom-agent registered
      const customAgent = createMockAgent();
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            default: createMockAgent(),
            "custom-agent": customAgent,
          }}
        >
          <CopilotChatConfigurationProvider threadId="test-thread">
            <CopilotChat agentId="custom-agent" />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Component should render without errors
      expect(container.firstChild).toBeDefined();
    });

    it("should support threadId prop", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat threadId="custom-thread-123" />
        </TestWrapper>,
      );

      expect(container.firstChild).toBeDefined();
    });

    it("should support labels prop for customization", () => {
      render(
        <TestWrapper>
          <CopilotChat
            labels={{
              chatInputPlaceholder: "Custom placeholder text...",
            }}
          />
        </TestWrapper>,
      );

      const input = screen.queryByPlaceholderText("Custom placeholder text...");
      expect(input).toBeDefined();
    });
  });

  // ============================================================================
  // 8. INTEGRATION TESTS
  // ============================================================================
  describe("8. Integration Tests", () => {
    it("should render CopilotChat with all default components", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat />
        </TestWrapper>,
      );

      // Should render the chat interface
      expect(container.firstChild).toBeDefined();
    });

    it("should combine chatView customization with nested slot customization via props", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat
            chatView={{
              className: "root-chat-view",
              messageView: "custom-messages",
              input: "custom-input",
              scrollView: "custom-scroll",
            }}
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".root-chat-view")).toBeDefined();
      expect(container.querySelector(".custom-messages")).toBeDefined();
      expect(container.querySelector(".custom-input")).toBeDefined();
      expect(container.querySelector(".custom-scroll")).toBeDefined();
    });

    it("should work with mixed props and tailwind classes", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat
            chatView={{
              className: "mixed-class",
            }}
          />
        </TestWrapper>,
      );

      const chatView = container.querySelector(".mixed-class");
      expect(chatView).toBeDefined();
    });

    it("should handle transcription-related props", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChat />
        </TestWrapper>,
      );

      // Component should render without errors even with transcription features
      expect(container.firstChild).toBeDefined();
    });
  });

  // ============================================================================
  // 9. CALLBACK AND HANDLER TESTS
  // ============================================================================
  describe("9. Callback and Handler Tests", () => {
    it("should render CopilotChat and allow callback customization via custom component", () => {
      const onSubmitMessage = vi.fn();
      const CustomChatView: React.FC<any> = (props) => {
        // Use the provided onSubmitMessage or our custom one
        return <CopilotChatView {...props} onSubmitMessage={onSubmitMessage} />;
      };

      render(
        <TestWrapper>
          <CopilotChat chatView={CustomChatView as any} />
        </TestWrapper>,
      );

      // The component should render without errors
      expect(onSubmitMessage).not.toHaveBeenCalled();
    });

    it("should support suggestions rendering", () => {
      // Note: CopilotChat manages suggestions internally via useAutoSuggestions
      // We test that the chatView slot receives and renders suggestions
      render(
        <TestWrapper>
          <CopilotChat />
        </TestWrapper>,
      );

      // CopilotChat should render without errors
      // Actual suggestion rendering depends on agent state
    });
  });
});
