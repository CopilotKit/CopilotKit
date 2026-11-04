import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect } from "vitest";
import { CopilotChat } from "../CopilotChat";
import type { CopilotChatProps } from "../CopilotChat";
import { CopilotChatView } from "../CopilotChatView";
import type { CopilotChatViewProps } from "../CopilotChatView";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";

// Wrapper to provide required context with mock agent
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider
    agents__unsafe_dev_only={{ default: new MockStepwiseAgent() }}
  >
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

function renderChat(props: Partial<CopilotChatProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotChat {...props} />
    </TestWrapper>,
  );
}

const chatView = () => screen.getByTestId("copilot-chat");

// The chat view's own slots are covered in CopilotChatView.slots.e2e. The
// agentId, threadId and labels props are covered in the other CopilotChat
// test files. These tests pin that CopilotChat forwards the chatView slot.
describe("CopilotChat Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override - chatView Slot", () => {
    it("merges a tailwind class string into the chat view's default classes", () => {
      renderChat({ chatView: "bg-gradient-to-b rounded-xl shadow-2xl" });

      expect(chatView()).toHaveClass(
        "cpk-chat-view",
        "bg-gradient-to-b",
        "rounded-xl",
        "shadow-2xl",
      );
    });
  });

  describe("2. Property Passing - chatView Slot", () => {
    it("should pass custom props to chatView", () => {
      const chatViewProps: Partial<
        React.ComponentProps<typeof CopilotChatView>
      > & { "data-testid": string } = { "data-testid": "custom-chat-view" };

      renderChat({ chatView: chatViewProps });

      expect(screen.getByTestId("custom-chat-view")).toHaveClass(
        "cpk-chat-view",
      );
    });

    it("should pass className through props object", () => {
      renderChat({ chatView: { className: "custom-class-from-props" } });

      expect(chatView()).toHaveClass("custom-class-from-props");
    });
  });

  describe("3. Custom Component - chatView Slot", () => {
    it("should allow custom component for chatView", () => {
      const CustomChatView: React.FC<CopilotChatViewProps> = () => (
        <div data-testid="custom-chat-view-component">
          Custom Chat Interface
        </div>
      );

      renderChat({ chatView: CustomChatView });

      expect(
        screen.getByTestId("custom-chat-view-component"),
      ).toHaveTextContent("Custom Chat Interface");
      expect(screen.queryByTestId("copilot-chat")).toBeNull();
    });

    it("should pass the chat view props to a custom chatView component", () => {
      let received: CopilotChatViewProps | undefined;
      const CustomChatView: React.FC<CopilotChatViewProps> = (props) => {
        received = props;
        return <div />;
      };

      renderChat({ chatView: CustomChatView });

      expect(received?.messages).toEqual([]);
      expect(received?.isRunning).toBe(false);
      expect(received?.onSubmitMessage).toBeInstanceOf(Function);
    });

    it("lets a custom chatView component wrap the default chat view", () => {
      const CustomChatView: React.FC<CopilotChatViewProps> = (props) => (
        <div data-testid="fully-custom-chat">
          <CopilotChatView {...props} input="custom-input-from-wrapper" />
        </div>
      );

      renderChat({ chatView: CustomChatView });

      const wrapper = screen.getByTestId("fully-custom-chat");
      expect(within(wrapper).getByTestId("copilot-chat")).toBeInTheDocument();
      expect(wrapper.querySelector(".cpk-chat-input")).toHaveClass(
        "custom-input-from-wrapper",
      );
    });
  });

  describe("4. Drill-down into CopilotChatView Sub-slots via Props Object", () => {
    it("passes nested chat view slots through the chatView props object", () => {
      // Without the welcome screen the empty chat shows its message list.
      const { container } = renderChat({
        chatView: {
          welcomeScreen: false,
          messageView: "custom-message-view-class",
          input: "custom-input-class",
          scrollView: "custom-scroll-view",
        },
      });

      expect(
        container.querySelector("[data-testid=copilot-message-list]"),
      ).toHaveClass("custom-message-view-class");
      expect(container.querySelector(".cpk-chat-input")).toHaveClass(
        "custom-input-class",
      );
      expect(container.querySelector(".custom-scroll-view")).not.toBeNull();
    });
  });

  describe("5. Default rendering", () => {
    it("should render CopilotChat with all default components", () => {
      renderChat();

      expect(within(chatView()).getByRole("textbox")).toBeInTheDocument();
    });
  });
});
