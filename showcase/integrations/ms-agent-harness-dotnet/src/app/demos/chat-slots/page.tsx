"use client";

import React from "react";
import type {
  CopilotChatAssistantMessage,
  CopilotChatUserMessage,
  CopilotChatReasoningMessage,
  CopilotChatView,
  CopilotChatInput,
} from "@copilotkit/react-core/v2";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
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
import { makeSlotOverride } from "../_shared/slot-override";
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

  // Slot overrides go through `makeSlotOverride<TDefault>(component)` so
  // the cast is centralized in one named helper instead of sprinkled
  // through this file. See `../_shared/slot-override.ts` for the why.
  const welcomeScreen =
    makeSlotOverride<typeof CopilotChatView.WelcomeScreen>(CustomWelcomeScreen);

  // The input prop accepts both slot overrides AND CopilotChatInput's rest
  // props (toolsMenu, mode, etc.) merged together. We seed `toolsMenu` so the
  // addMenuButton slot has a reason to render.
  const input = {
    textArea:
      makeSlotOverride<typeof CopilotChatInput.TextArea>(CustomTextArea),
    sendButton:
      makeSlotOverride<typeof CopilotChatInput.SendButton>(CustomSendButton),
    disclaimer:
      makeSlotOverride<typeof CopilotChatInput.Disclaimer>(CustomDisclaimer),
    addMenuButton:
      makeSlotOverride<typeof CopilotChatInput.AddMenuButton>(
        CustomAddMenuButton,
      ),
    toolsMenu: [
      {
        label: "Demo tool (no-op)",
        action: () => {},
      },
    ],
  };

  const messageView = {
    assistantMessage: makeSlotOverride<typeof CopilotChatAssistantMessage>(
      CustomAssistantMessage,
    ),
    userMessage:
      makeSlotOverride<typeof CopilotChatUserMessage>(CustomUserMessage),
    reasoningMessage: makeSlotOverride<typeof CopilotChatReasoningMessage>(
      CustomReasoningMessage,
    ),
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
