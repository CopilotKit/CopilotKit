// Type-only assertions for #7126 / #7158. `tsc --noEmit` is the only consumer —
// this file is not in vitest's `*.{test,spec}.{ts,tsx}` include glob.
//
// chatView is SlotValue<React.ComponentType<CopilotChatViewProps>>, so a plain
// FC / call signature assigns without CopilotChatView namespace statics
// (WelcomeScreen, ScrollView, …) and without Object.assign or a cast.
//
// #7158 extends the same widening to the sibling slots that still carried
// statics: `input` (CopilotChatView, re-exposed on <CopilotChat>) and `header`
// (CopilotSidebarView / CopilotPopupView). renderSlot only ever calls
// React.createElement(slot, props), so the statics were never needed at runtime.
import { expectTypeOf } from "vitest";
import type React from "react";
import type { CopilotChatProps } from "../CopilotChat";
import type { CopilotChatViewProps } from "../CopilotChatView";
import type { CopilotChatView } from "../CopilotChatView";
import type { CopilotChatInputProps } from "../CopilotChatInput";
import type { CopilotChatInput } from "../CopilotChatInput";
import type { CopilotModalHeaderProps } from "../CopilotModalHeader";
import type { CopilotModalHeader } from "../CopilotModalHeader";
import type { CopilotSidebarViewProps } from "../CopilotSidebarView";
import type { CopilotPopupViewProps } from "../CopilotPopupView";

type ChatViewSlot = NonNullable<CopilotChatProps["chatView"]>;

// The four slots #7158 widens: CopilotChatView's own `input`, its re-export on
// <CopilotChat>, and the two modal `header` slots.
type ChatViewInputSlot = NonNullable<CopilotChatViewProps["input"]>;
type InputSlot = NonNullable<CopilotChatProps["input"]>;
type SidebarHeaderSlot = NonNullable<CopilotSidebarViewProps["header"]>;
type PopupHeaderSlot = NonNullable<CopilotPopupViewProps["header"]>;

// ── chatView (#7126, already widened by #7156) ──────────────────────────
type CustomChatView = React.FC<CopilotChatViewProps>;
type CustomChatViewFn = (props: CopilotChatViewProps) => React.ReactNode;

expectTypeOf<CustomChatView>().toExtend<ChatViewSlot>();
expectTypeOf<CustomChatViewFn>().toExtend<ChatViewSlot>();
expectTypeOf<typeof CopilotChatView>().toExtend<ChatViewSlot>();
expectTypeOf<string>().toExtend<ChatViewSlot>();
expectTypeOf<Partial<CopilotChatViewProps>>().toExtend<ChatViewSlot>();

// ── #7158: input and header slots ───────────────────────────────────────

type CustomInput = React.FC<CopilotChatInputProps>;
type CustomInputFn = (props: CopilotChatInputProps) => React.ReactNode;
type CustomHeader = React.FC<CopilotModalHeaderProps>;
type CustomHeaderFn = (props: CopilotModalHeaderProps) => React.ReactNode;

// A plain FC / call signature assigns to every affected slot — no statics.
expectTypeOf<CustomInput>().toExtend<ChatViewInputSlot>();
expectTypeOf<CustomInputFn>().toExtend<ChatViewInputSlot>();
expectTypeOf<CustomInput>().toExtend<InputSlot>();
expectTypeOf<CustomInputFn>().toExtend<InputSlot>();
expectTypeOf<CustomHeader>().toExtend<SidebarHeaderSlot>();
expectTypeOf<CustomHeaderFn>().toExtend<SidebarHeaderSlot>();
expectTypeOf<CustomHeader>().toExtend<PopupHeaderSlot>();
expectTypeOf<CustomHeaderFn>().toExtend<PopupHeaderSlot>();

// Exotic components — React.memo / forwardRef — are what real callers pass.
// Both are callable components, so they must keep assigning after the widening.
type MemoInput = ReturnType<typeof React.memo<React.FC<CopilotChatInputProps>>>;
type MemoHeader = ReturnType<
  typeof React.memo<React.FC<CopilotModalHeaderProps>>
>;
type ForwardedInput = ReturnType<
  typeof React.forwardRef<HTMLDivElement, CopilotChatInputProps>
>;
type ForwardedHeader = ReturnType<
  typeof React.forwardRef<HTMLDivElement, CopilotModalHeaderProps>
>;

expectTypeOf<MemoInput>().toExtend<ChatViewInputSlot>();
expectTypeOf<ForwardedInput>().toExtend<ChatViewInputSlot>();
expectTypeOf<MemoInput>().toExtend<InputSlot>();
expectTypeOf<ForwardedInput>().toExtend<InputSlot>();
expectTypeOf<MemoHeader>().toExtend<SidebarHeaderSlot>();
expectTypeOf<ForwardedHeader>().toExtend<SidebarHeaderSlot>();
expectTypeOf<MemoHeader>().toExtend<PopupHeaderSlot>();
expectTypeOf<ForwardedHeader>().toExtend<PopupHeaderSlot>();

// The previously accepted forms still work: the default component, the
// className arm, and the partial-props arm of SlotValue.
expectTypeOf<typeof CopilotChatInput>().toExtend<ChatViewInputSlot>();
expectTypeOf<typeof CopilotChatInput>().toExtend<InputSlot>();
expectTypeOf<typeof CopilotModalHeader>().toExtend<SidebarHeaderSlot>();
expectTypeOf<typeof CopilotModalHeader>().toExtend<PopupHeaderSlot>();
expectTypeOf<string>().toExtend<ChatViewInputSlot>();
expectTypeOf<string>().toExtend<SidebarHeaderSlot>();
expectTypeOf<Partial<CopilotChatInputProps>>().toExtend<ChatViewInputSlot>();
expectTypeOf<Partial<CopilotModalHeaderProps>>().toExtend<SidebarHeaderSlot>();

// ── negatives: the widening must not loosen prop checking into `any` ────

// A component demanding a prop the parent never passes is rejected.
type InputWithUnknownRequiredProp = React.FC<
  CopilotChatInputProps & { notPassedByParent: string }
>;
type HeaderWithUnknownRequiredProp = React.FC<
  CopilotModalHeaderProps & { notPassedByParent: string }
>;
expectTypeOf<InputWithUnknownRequiredProp>().not.toExtend<ChatViewInputSlot>();
expectTypeOf<HeaderWithUnknownRequiredProp>().not.toExtend<SidebarHeaderSlot>();

// A component whose prop type conflicts with the slot's is rejected
// (`title` is `string | undefined` on CopilotModalHeaderProps).
type HeaderWithConflictingTitle = React.FC<
  Omit<CopilotModalHeaderProps, "title"> & { title: number }
>;
expectTypeOf<HeaderWithConflictingTitle>().not.toExtend<SidebarHeaderSlot>();
expectTypeOf<HeaderWithConflictingTitle>().not.toExtend<PopupHeaderSlot>();

// A non-component value is rejected.
expectTypeOf<number>().not.toExtend<ChatViewInputSlot>();
expectTypeOf<number>().not.toExtend<SidebarHeaderSlot>();
expectTypeOf<number>().not.toExtend<PopupHeaderSlot>();

// ── Message slots: messageView, assistantMessage, userMessage, reasoningMessage ──
// Same widening as #7158. The docs replace these slots with plain components,
// and renderSlot / resolveSlotComponent never read the default components'
// statics (Cursor, Header, Toolbar, MarkdownRenderer, …).
import type { CopilotChatMessageViewProps } from "../CopilotChatMessageView";
import type { CopilotChatAssistantMessageProps } from "../CopilotChatAssistantMessage";
import type { CopilotChatUserMessageProps } from "../CopilotChatUserMessage";
import type { CopilotChatReasoningMessageProps } from "../CopilotChatReasoningMessage";
import type CopilotChatMessageView from "../CopilotChatMessageView";
import type CopilotChatAssistantMessage from "../CopilotChatAssistantMessage";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";

type MessageViewSlot = NonNullable<CopilotChatViewProps["messageView"]>;
type AssistantMessageSlot = NonNullable<
  CopilotChatMessageViewProps["assistantMessage"]
>;
type UserMessageSlot = NonNullable<CopilotChatMessageViewProps["userMessage"]>;
type ReasoningMessageSlot = NonNullable<
  CopilotChatMessageViewProps["reasoningMessage"]
>;

expectTypeOf<
  React.FC<CopilotChatMessageViewProps>
>().toExtend<MessageViewSlot>();
expectTypeOf<
  React.FC<CopilotChatAssistantMessageProps>
>().toExtend<AssistantMessageSlot>();
expectTypeOf<
  React.FC<CopilotChatUserMessageProps>
>().toExtend<UserMessageSlot>();
expectTypeOf<
  React.FC<CopilotChatReasoningMessageProps>
>().toExtend<ReasoningMessageSlot>();

// The defaults, class strings and prop overrides still assign.
expectTypeOf<typeof CopilotChatMessageView>().toExtend<MessageViewSlot>();
expectTypeOf<
  typeof CopilotChatAssistantMessage
>().toExtend<AssistantMessageSlot>();
expectTypeOf<string>().toExtend<AssistantMessageSlot>();
expectTypeOf<
  Partial<CopilotChatAssistantMessageProps>
>().toExtend<AssistantMessageSlot>();

// ── onError: <CopilotChat> takes the agent-error handler, not the DOM one ──
// A handler written for the agent error must assign. While the DOM `onError`
// of the view's <div> was still in CopilotChatProps, the prop was the
// intersection of both handler types and this failed.
type ChatOnError = NonNullable<CopilotChatProps["onError"]>;
type AgentErrorHandler = (event: {
  error: Error;
  code: CopilotKitCoreErrorCode;
  context: Record<string, any>;
}) => void;
expectTypeOf<AgentErrorHandler>().toExtend<ChatOnError>();
