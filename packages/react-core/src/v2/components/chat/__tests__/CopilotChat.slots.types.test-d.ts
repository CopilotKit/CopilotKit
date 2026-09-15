// Type-only assertions for #7126. `tsc --noEmit` is the only consumer — this
// file is not in vitest's `*.{test,spec}.{ts,tsx}` include glob.
//
// chatView is SlotValue<React.ComponentType<CopilotChatViewProps>>, so a plain
// FC / call signature assigns without CopilotChatView namespace statics
// (WelcomeScreen, ScrollView, …) and without Object.assign or a cast.
//
// #7158 extends the same widening to the two sibling slots that carried statics:
// `input` (CopilotChatView/CopilotChat) and `header` (CopilotSidebarView /
// CopilotPopupView).
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

type CustomChatView = React.FC<CopilotChatViewProps>;
type CustomChatViewFn = (props: CopilotChatViewProps) => React.ReactNode;

expectTypeOf<CustomChatView>().toExtend<ChatViewSlot>();
expectTypeOf<CustomChatViewFn>().toExtend<ChatViewSlot>();
expectTypeOf<typeof CopilotChatView>().toExtend<ChatViewSlot>();
expectTypeOf<string>().toExtend<ChatViewSlot>();
expectTypeOf<Partial<CopilotChatViewProps>>().toExtend<ChatViewSlot>();

// ── #7158: input and header slots ──────────────────────────────────────

type InputSlot = NonNullable<CopilotChatProps["input"]>;
type HeaderSlot = NonNullable<CopilotSidebarViewProps["header"]>;
type PopupHeaderSlot = NonNullable<CopilotPopupViewProps["header"]>;

type CustomInput = React.FC<CopilotChatInputProps>;
type CustomInputFn = (props: CopilotChatInputProps) => React.ReactNode;
type CustomHeader = React.FC<CopilotModalHeaderProps>;

expectTypeOf<CustomInput>().toExtend<InputSlot>();
expectTypeOf<CustomInputFn>().toExtend<InputSlot>();
expectTypeOf<typeof CopilotChatInput>().toExtend<InputSlot>();
expectTypeOf<string>().toExtend<InputSlot>();
expectTypeOf<Partial<CopilotChatInputProps>>().toExtend<InputSlot>();

expectTypeOf<CustomHeader>().toExtend<HeaderSlot>();
expectTypeOf<typeof CopilotModalHeader>().toExtend<HeaderSlot>();
expectTypeOf<string>().toExtend<HeaderSlot>();
expectTypeOf<Partial<CopilotModalHeaderProps>>().toExtend<HeaderSlot>();
expectTypeOf<CustomHeader>().toExtend<PopupHeaderSlot>();

// The widening must not loosen prop checking: a component demanding a prop the
// parent never passes is still rejected (it does NOT extend the slot type).
type InputWithUnknownRequiredProp = React.FC<
  CopilotChatInputProps & { notPassedByParent: string }
>;
expectTypeOf<InputWithUnknownRequiredProp>().not.toExtend<InputSlot>();
