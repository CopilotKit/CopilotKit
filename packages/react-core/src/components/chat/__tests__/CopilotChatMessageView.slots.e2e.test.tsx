import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect } from "vitest";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import type { CopilotChatMessageViewProps } from "../CopilotChatMessageView";
import type {
  CopilotChatAssistantMessage,
  CopilotChatAssistantMessageProps,
} from "../CopilotChatAssistantMessage";
import type {
  CopilotChatUserMessage,
  CopilotChatUserMessageProps,
} from "../CopilotChatUserMessage";
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
  { id: "2", role: "assistant" as const, content: "Hi there! How can I help?" },
  { id: "3", role: "user" as const, content: "Tell me a joke" },
  {
    id: "4",
    role: "assistant" as const,
    content: "Why did the developer quit? Because he didn't get arrays!",
  },
];

// The cursor shows while a run waits for the reply to the last user message.
const awaitingReply = {
  messages: [{ id: "1", role: "user" as const, content: "Hello" }],
  isRunning: true,
};

function renderView(props: Partial<CopilotChatMessageViewProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotChatMessageView messages={sampleMessages} {...props} />
    </TestWrapper>,
  );
}

const assistantMessages = () =>
  screen.getAllByTestId("copilot-assistant-message");
const userMessages = () => screen.getAllByTestId("copilot-user-message");

// Sub-slots inside a message (copyButton, toolbar, ...) are covered in
// CopilotChatAssistantMessage.slots.e2e.test.tsx and
// CopilotChatUserMessage.slots.e2e.test.tsx. Thumbs callbacks passed through
// the assistantMessage slot are covered in
// CopilotChat.raw-event-feedback.test.tsx.
describe("CopilotChatMessageView Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    it("adds a string assistantMessage slot to every assistant message", () => {
      renderView({ assistantMessage: "bg-blue-100 rounded-lg" });

      const messages = assistantMessages();
      expect(messages).toHaveLength(2);
      for (const el of messages) {
        expect(el).toHaveClass("copilotKitAssistantMessage", "bg-blue-100");
      }
    });

    it("adds a string userMessage slot to every user message", () => {
      renderView({ userMessage: "bg-green-100 ml-auto" });

      const messages = userMessages();
      expect(messages).toHaveLength(2);
      for (const el of messages) {
        expect(el).toHaveClass("cpk-user-message", "bg-green-100", "ml-auto");
      }
    });

    it("should apply tailwind class string to cursor", () => {
      renderView({ ...awaitingReply, cursor: "animate-pulse bg-gray-400" });

      expect(screen.getByTestId("copilot-loading-cursor")).toHaveClass(
        "cpk-message-view-cursor",
        "animate-pulse",
        "bg-gray-400",
      );
    });
  });

  describe("2. Properties Slot Override", () => {
    it("should pass data-testid prop to assistantMessage", () => {
      const assistantMessageProps: Partial<CopilotChatAssistantMessageProps> & {
        "data-testid": string;
      } = { "data-testid": "assistant-with-testid" };

      renderView({ assistantMessage: assistantMessageProps });

      expect(screen.getAllByTestId("assistant-with-testid")).toHaveLength(2);
    });

    it("should pass data-testid prop to userMessage", () => {
      const userMessageProps: Partial<CopilotChatUserMessageProps> & {
        "data-testid": string;
      } = { "data-testid": "user-with-testid" };

      renderView({ userMessage: userMessageProps });

      expect(screen.getAllByTestId("user-with-testid")).toHaveLength(2);
    });

    it("should pass data-testid prop to cursor", () => {
      const cursorProps: React.HTMLAttributes<HTMLDivElement> & {
        "data-testid": string;
      } = { "data-testid": "custom-cursor-testid" };

      renderView({ ...awaitingReply, cursor: cursorProps });

      expect(screen.getByTestId("custom-cursor-testid")).toBeInTheDocument();
    });

    it("hides the toolbar of every assistant message with toolbarVisible false", () => {
      renderView({ assistantMessage: { toolbarVisible: false } });

      expect(screen.queryByTestId("copilot-assistant-toolbar")).toBeNull();
    });

    it("user className should be added in object slots", () => {
      renderView({
        assistantMessage: { className: "user-override-assistant" },
        userMessage: { className: "user-override-user" },
      });

      for (const el of assistantMessages()) {
        expect(el).toHaveClass("user-override-assistant");
      }
      for (const el of userMessages()) {
        expect(el).toHaveClass("user-override-user");
      }
    });
  });

  describe("3. Custom Component Slot Override", () => {
    it("should render custom assistantMessage component", () => {
      const CustomAssistant: React.FC<any> = ({ message }) => (
        <div data-testid="custom-assistant">AI: {message?.content}</div>
      );

      renderView({
        assistantMessage: CustomAssistant as typeof CopilotChatAssistantMessage,
      });

      const rendered = screen.getAllByTestId("custom-assistant");
      expect(rendered.map((el) => el.textContent)).toEqual([
        "AI: Hi there! How can I help?",
        "AI: Why did the developer quit? Because he didn't get arrays!",
      ]);
    });

    it("custom assistantMessage should receive message, messages and isRunning", () => {
      const receivedProps: any[] = [];
      const CustomAssistant: React.FC<any> = (props) => {
        receivedProps.push(props);
        return <div>{props.message?.content}</div>;
      };

      renderView({
        isRunning: true,
        assistantMessage: CustomAssistant as typeof CopilotChatAssistantMessage,
      });

      const last = receivedProps[receivedProps.length - 1];
      expect(last.message.id).toBe("4");
      expect(last.messages).toHaveLength(4);
      expect(last.isRunning).toBe(true);
    });

    it("should render custom userMessage component", () => {
      const CustomUser: React.FC<any> = ({ message }) => (
        <div data-testid="custom-user">You: {message?.content}</div>
      );

      renderView({ userMessage: CustomUser as typeof CopilotChatUserMessage });

      const rendered = screen.getAllByTestId("custom-user");
      expect(rendered.map((el) => el.textContent)).toEqual([
        "You: Hello",
        "You: Tell me a joke",
      ]);
    });

    it("should render custom cursor component", () => {
      const CustomCursor = () => <span data-testid="custom-cursor">▊</span>;

      renderView({ ...awaitingReply, cursor: CustomCursor });

      expect(screen.getByTestId("custom-cursor")).toHaveTextContent("▊");
      expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
    });
  });

  describe("4. Recursive Subcomponent Drill-Down", () => {
    it("passes a nested sub-slot through the assistantMessage object slot", () => {
      const CustomCopyButton: React.FC = () => (
        <button data-testid="custom-copy">Copy Text</button>
      );

      renderView({ assistantMessage: { copyButton: CustomCopyButton } });

      expect(screen.getAllByTestId("custom-copy")).toHaveLength(2);
    });

    it("passes a nested sub-slot through the userMessage object slot", () => {
      const CustomCopy: React.FC = () => (
        <button data-testid="custom-user-copy">Copy Mine</button>
      );

      renderView({ userMessage: { copyButton: CustomCopy } });

      expect(screen.getAllByTestId("custom-user-copy")).toHaveLength(2);
    });
  });

  describe("6. Children Render Function", () => {
    it("should support children render function for message view layout", () => {
      render(
        <TestWrapper>
          <CopilotChatMessageView messages={sampleMessages}>
            {({ messageElements }) => (
              <div data-testid="custom-message-layout">{messageElements}</div>
            )}
          </CopilotChatMessageView>
        </TestWrapper>,
      );

      expect(screen.getByTestId("custom-message-layout")).toHaveTextContent(
        "Tell me a joke",
      );
    });
  });
});
