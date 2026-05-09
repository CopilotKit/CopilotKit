"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  CopilotChatUserMessage,
  CopilotChatReasoningMessage,
  CopilotChatView,
  CopilotChatInput,
} from "@copilotkit/react-core/v2";
import {
  CustomWelcomeScreen,
  CustomAssistantMessage,
  CustomUserMessage,
  CustomReasoningMessage,
  CustomCursor,
  CustomTextArea,
  CustomSendButton,
  CustomDisclaimer,
  CustomAddMenuButton,
  CustomSuggestionContainer,
  CustomSuggestion,
  CustomScrollToBottomButton,
  CustomFeather,
} from "./slot-wrappers";
import { useChatSlotsSuggestions } from "./suggestions";

// "Slot Atlas" — every overrideable slot on CopilotChat is wrapped in a
// dashed, color-coded marker so a developer can see at a glance what is
// customizable and where it lives. Hover any region to reveal its slot path.
export default function ChatSlotsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat-slots">
      <div className="flex flex-col h-screen w-full bg-background">
        <div className="flex-1 flex justify-center items-stretch p-4 min-h-0">
          <div className="h-full w-full max-w-5xl">
            <Chat />
          </div>
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useChatSlotsSuggestions();

  // Each slot type below is cast through `unknown` because @copilotkit/react-
  // core's WithSlots types want the EXACT default component identity, while
  // our wrappers return ReactElements that are structurally compatible but
  // not nominally identical. The runtime contract still holds.
  const welcomeScreen =
    CustomWelcomeScreen as unknown as typeof CopilotChatView.WelcomeScreen;

  // The input prop accepts both slot overrides AND CopilotChatInput's rest
  // props (toolsMenu, mode, etc.) merged together. We seed `toolsMenu` so the
  // addMenuButton slot has a reason to render.
  const input = {
    textArea: CustomTextArea as unknown as typeof CopilotChatInput.TextArea,
    sendButton:
      CustomSendButton as unknown as typeof CopilotChatInput.SendButton,
    disclaimer:
      CustomDisclaimer as unknown as typeof CopilotChatInput.Disclaimer,
    addMenuButton:
      CustomAddMenuButton as unknown as typeof CopilotChatInput.AddMenuButton,
    toolsMenu: [
      {
        label: "Demo tool (no-op)",
        action: () => {},
      },
    ],
  };

  const messageView = {
    assistantMessage:
      CustomAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
    userMessage: CustomUserMessage as unknown as typeof CopilotChatUserMessage,
    reasoningMessage:
      CustomReasoningMessage as unknown as typeof CopilotChatReasoningMessage,
    cursor: CustomCursor,
  };

  const suggestionView = {
    container: CustomSuggestionContainer,
    suggestion: CustomSuggestion,
  };

  const scrollView = {
    scrollToBottomButton: CustomScrollToBottomButton,
    feather: CustomFeather,
  };

  return (
    <CopilotChat
      agentId="chat-slots"
      className="h-full rounded-2xl border border-border/60 bg-card overflow-hidden"
      welcomeScreen={welcomeScreen}
      input={input}
      messageView={messageView}
      suggestionView={suggestionView}
      scrollView={scrollView}
    />
  );
}
