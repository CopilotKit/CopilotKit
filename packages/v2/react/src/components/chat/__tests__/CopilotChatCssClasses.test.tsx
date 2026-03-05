import React from "react";
import { render, screen } from "@testing-library/react";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView from "../CopilotChatMessageView";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotModalHeader } from "../CopilotModalHeader";
import { CopilotChatToggleButton } from "../CopilotChatToggleButton";
import { CopilotChatView } from "../CopilotChatView";
import { AssistantMessage, Message, UserMessage } from "@ag-ui/core";

const TEST_THREAD_ID = "test-thread";

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        {component}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
};

describe("v2 CopilotChat CSS class compatibility with v1", () => {
  describe("CopilotChatMessageView", () => {
    it("includes copilotKitMessages class", () => {
      const messages: Message[] = [];

      renderWithProvider(<CopilotChatMessageView messages={messages} />);

      const messageList = screen.getByTestId("copilot-message-list");
      expect(messageList.className).toContain("copilotKitMessages");
    });
  });

  describe("CopilotChatAssistantMessage", () => {
    it("includes copilotKitMessage and copilotKitAssistantMessage classes", () => {
      const message: AssistantMessage = {
        role: "assistant",
        content: "Hello from the assistant",
        id: "test-assistant-1",
      };

      renderWithProvider(<CopilotChatAssistantMessage message={message} />);

      const el = screen.getByTestId("copilot-assistant-message");
      expect(el.className).toContain("copilotKitMessage");
      expect(el.className).toContain("copilotKitAssistantMessage");
    });
  });

  describe("CopilotChatUserMessage", () => {
    it("includes copilotKitMessage and copilotKitUserMessage classes", () => {
      const message: UserMessage = {
        role: "user",
        content: "Hello from the user",
        id: "test-user-1",
      };

      renderWithProvider(<CopilotChatUserMessage message={message} />);

      const el = screen.getByTestId("copilot-user-message");
      expect(el.className).toContain("copilotKitMessage");
      expect(el.className).toContain("copilotKitUserMessage");
    });
  });

  describe("CopilotChatInput", () => {
    it("includes copilotKitInput class", () => {
      renderWithProvider(<CopilotChatInput />);

      const el = screen.getByTestId("copilot-chat-input");
      expect(el.className).toContain("copilotKitInput");
    });
  });

  describe("CopilotModalHeader", () => {
    it("includes copilotKitHeader class", () => {
      renderWithProvider(<CopilotModalHeader />);

      const el = screen.getByTestId("copilot-modal-header");
      expect(el.className).toContain("copilotKitHeader");
    });
  });

  describe("CopilotChatToggleButton", () => {
    it("includes copilotKitButton class", () => {
      renderWithProvider(<CopilotChatToggleButton />);

      const el = screen.getByTestId("copilot-chat-toggle");
      expect(el.className).toContain("copilotKitButton");
    });
  });

  describe("CopilotChatView", () => {
    it("includes copilotKitChat class", () => {
      renderWithProvider(
        <CopilotChatView messages={[]} welcomeScreen={false} />,
      );

      const el = screen.getByTestId("copilot-chat");
      expect(el.className).toContain("copilotKitChat");
    });
  });
});
