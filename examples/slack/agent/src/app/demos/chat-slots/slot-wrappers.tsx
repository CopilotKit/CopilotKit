"use client";

import React from "react";
import {
  CopilotChatAssistantMessage,
  CopilotChatUserMessage,
  CopilotChatReasoningMessage,
  CopilotChatMessageView,
  CopilotChatView,
  CopilotChatInput,
  CopilotChatSuggestionPill,
  type CopilotChatAssistantMessageProps,
  type CopilotChatUserMessageProps,
  type CopilotChatReasoningMessageProps,
  type CopilotChatSuggestionPillProps,
} from "@copilotkit/react-core/v2";
import { SlotMarker } from "./slot-marker";

// =====================================================================
// welcomeScreen + welcomeScreen.welcomeMessage
// The welcomeScreen receives `input` and `suggestionView` as elements; we
// also expose the `welcomeMessage` sub-slot to show that slots can nest.
// =====================================================================
export function CustomWelcomeMessage(
  props: React.HTMLAttributes<HTMLDivElement>,
) {
  return (
    <SlotMarker color="violet" label="WelcomeScreen.WelcomeMessage">
      <div
        {...props}
        className="text-center px-4 py-3 text-sm text-muted-foreground"
        data-testid="custom-welcome-message"
      >
        Hover any region to see its slot path · click the badge to copy
      </div>
    </SlotMarker>
  );
}

export function CustomWelcomeScreen({
  input,
  suggestionView,
}: {
  input: React.ReactElement;
  suggestionView: React.ReactElement;
  welcomeMessage?: React.ReactElement;
}) {
  return (
    <SlotMarker color="indigo" label="WelcomeScreen" className="flex-1 m-3">
      <div
        data-testid="custom-welcome-screen"
        className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4 w-full"
      >
        <CustomWelcomeMessage />
        <div className="w-full max-w-2xl">{input}</div>
        <div className="flex justify-center">{suggestionView}</div>
      </div>
    </SlotMarker>
  );
}

// =====================================================================
// messageView.assistantMessage
// =====================================================================
export function CustomAssistantMessage(
  props: CopilotChatAssistantMessageProps,
) {
  return (
    <SlotMarker
      color="emerald"
      label="MessageView.AssistantMessage"
      className="my-3"
    >
      <CopilotChatAssistantMessage {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// messageView.userMessage
// =====================================================================
export function CustomUserMessage(props: CopilotChatUserMessageProps) {
  return (
    <SlotMarker
      color="sky"
      label="MessageView.UserMessage"
      className="my-3 ml-auto"
    >
      <CopilotChatUserMessage {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// messageView.reasoningMessage
// Only renders when the message stream contains reasoning content.
// =====================================================================
export function CustomReasoningMessage(
  props: CopilotChatReasoningMessageProps,
) {
  return (
    <SlotMarker
      color="rose"
      label="MessageView.ReasoningMessage"
      className="my-2"
    >
      <CopilotChatReasoningMessage {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// messageView.cursor
// Renders while a message is streaming. Tiny — wrap inline.
// =====================================================================
export function CustomCursor(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <SlotMarker color="amber" label="MessageView.Cursor" inline>
      <CopilotChatMessageView.Cursor {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// input.textArea
// We wrap the default in a SlotMarker. The marker is `display: contents`-ish
// inside; the dashed border is on the marker's outer span.
// =====================================================================
export function CustomTextArea(
  props: React.ComponentProps<typeof CopilotChatInput.TextArea>,
) {
  return (
    <SlotMarker
      color="orange"
      label="Input.TextArea"
      className="flex-1 min-w-0"
    >
      <CopilotChatInput.TextArea {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// input.sendButton
// =====================================================================
export function CustomSendButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <SlotMarker color="red" label="Input.SendButton" inline>
      <CopilotChatInput.SendButton {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// input.disclaimer
// =====================================================================
export function CustomDisclaimer(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <SlotMarker
      color="yellow"
      label="Input.Disclaimer"
      className="mx-auto my-1.5"
    >
      <div
        {...props}
        data-testid="custom-disclaimer"
        className="text-xs text-center text-muted-foreground px-2 py-1"
      >
        Custom disclaimer slot · stays visible in every input variant
      </div>
    </SlotMarker>
  );
}

// =====================================================================
// input.addMenuButton
// Only renders if `onAddFile` or `toolsMenu` is set on CopilotChatInput.
// =====================================================================
export function CustomAddMenuButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <SlotMarker color="pink" label="Input.AddMenuButton" inline>
      <CopilotChatInput.AddMenuButton {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// suggestionView.container
// =====================================================================
export const CustomSuggestionContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CustomSuggestionContainer(props, ref) {
  return (
    <SlotMarker color="cyan" label="SuggestionView.Container" className="my-2">
      <div ref={ref} {...props} />
    </SlotMarker>
  );
});

// =====================================================================
// suggestionView.suggestion
// =====================================================================
export const CustomSuggestion = React.forwardRef<
  HTMLButtonElement,
  CopilotChatSuggestionPillProps
>(function CustomSuggestion(props, ref) {
  return (
    <SlotMarker color="teal" label="SuggestionView.Suggestion" inline>
      <CopilotChatSuggestionPill ref={ref} {...props} />
    </SlotMarker>
  );
});

// =====================================================================
// scrollView.scrollToBottomButton
// =====================================================================
export function CustomScrollToBottomButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <SlotMarker
      color="lime"
      label="ScrollView.ScrollToBottomButton"
      inline
      className="absolute bottom-20 right-6"
    >
      <CopilotChatView.ScrollToBottomButton {...props} />
    </SlotMarker>
  );
}

// =====================================================================
// scrollView.feather
// The default Feather is the gradient fade above the input. The default
// implementation is an empty div with absolute positioning, so we render
// our own visible gradient + a clickable copy badge so the slot is
// unambiguously visible.
// =====================================================================
export function CustomFeather(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-testid="custom-feather"
      className="slot-marker pointer-events-none absolute left-0 right-0 bottom-0 h-12 bg-gradient-to-t from-fuchsia-100/90 to-transparent dark:from-fuchsia-950/40"
    >
      <FeatherCopyLabel />
    </div>
  );
}

function FeatherCopyLabel() {
  const label = "ScrollView.Feather";
  const [copied, setCopied] = React.useState(false);
  const onCopy = React.useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(label);
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      } catch {
        // clipboard may be unavailable in non-secure contexts
      }
    },
    [],
  );
  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? "Copied!" : `Copy slot path: ${label}`}
      aria-label={`Copy slot path ${label}`}
      className="slot-label absolute -top-2 left-2 inline-flex items-center gap-1 rounded bg-fuchsia-500 text-white text-[9px] font-bold px-1.5 py-px shadow-sm z-10 whitespace-nowrap opacity-0 transition-opacity hover:brightness-110 cursor-pointer pointer-events-auto font-mono"
    >
      <span>{copied ? "Copied" : label}</span>
      <span aria-hidden="true" className="text-white/70 text-[8px]">
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}
