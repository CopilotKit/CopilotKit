// Type-only assertions for #7158. `tsc --noEmit` is the only consumer — this
// file is not in vitest's `*.{test,spec}.{ts,tsx}` include glob.
//
// #7126 / PR #7156 fixed `chatView`; the same defect remained on the two
// sibling slots whose declarations named a value carrying namespace statics:
// `input` (CopilotChatViewProps, re-exposed on <CopilotChat>) and `header`
// (CopilotSidebarViewProps / CopilotPopupViewProps). renderSlot only ever does
// React.createElement(slot, props), so the statics were never required at
// runtime — the type demanded Object.assign or a cast for nothing.
import { expectTypeOf } from "vitest";
import type React from "react";
import type { CopilotChatProps } from "../CopilotChat";
import type { CopilotChatViewProps } from "../CopilotChatView";
import type {
  default as CopilotChatInput,
  CopilotChatInputProps,
} from "../CopilotChatInput";
import type {
  CopilotModalHeader,
  CopilotModalHeaderProps,
} from "../CopilotModalHeader";
import type { CopilotSidebarViewProps } from "../CopilotSidebarView";
import type { CopilotPopupViewProps } from "../CopilotPopupView";

type InputSlot = NonNullable<CopilotChatProps["input"]>;
type ChatViewInputSlot = NonNullable<CopilotChatViewProps["input"]>;
type SidebarHeaderSlot = NonNullable<CopilotSidebarViewProps["header"]>;
type PopupHeaderSlot = NonNullable<CopilotPopupViewProps["header"]>;

type CustomInput = React.FC<CopilotChatInputProps>;
type CustomInputFn = (props: CopilotChatInputProps) => React.ReactNode;
type CustomHeader = React.FC<CopilotModalHeaderProps>;
type CustomHeaderFn = (props: CopilotModalHeaderProps) => React.ReactNode;

// A plain FC assigns to every affected slot without namespace statics.
expectTypeOf<CustomInput>().toExtend<ChatViewInputSlot>();
expectTypeOf<CustomInputFn>().toExtend<ChatViewInputSlot>();
expectTypeOf<CustomInput>().toExtend<InputSlot>();
expectTypeOf<CustomInputFn>().toExtend<InputSlot>();
expectTypeOf<CustomHeader>().toExtend<SidebarHeaderSlot>();
expectTypeOf<CustomHeaderFn>().toExtend<SidebarHeaderSlot>();
expectTypeOf<CustomHeader>().toExtend<PopupHeaderSlot>();
expectTypeOf<CustomHeaderFn>().toExtend<PopupHeaderSlot>();

// The defaults, the className form and the partial-props form keep working —
// these are the other two arms of SlotValue and the previously accepted value.
expectTypeOf<typeof CopilotChatInput>().toExtend<ChatViewInputSlot>();
expectTypeOf<typeof CopilotChatInput>().toExtend<InputSlot>();
expectTypeOf<typeof CopilotModalHeader>().toExtend<SidebarHeaderSlot>();
expectTypeOf<typeof CopilotModalHeader>().toExtend<PopupHeaderSlot>();
expectTypeOf<string>().toExtend<ChatViewInputSlot>();
expectTypeOf<string>().toExtend<SidebarHeaderSlot>();
expectTypeOf<Partial<CopilotChatInputProps>>().toExtend<ChatViewInputSlot>();
expectTypeOf<Partial<CopilotModalHeaderProps>>().toExtend<SidebarHeaderSlot>();

// Widening must not turn the slots into `any`: prop checking still holds.
// A component demanding a prop the parent never passes is rejected.
expectTypeOf<
  React.FC<CopilotChatInputProps & { requiredExtra: string }>
>().not.toExtend<ChatViewInputSlot>();
expectTypeOf<
  React.FC<CopilotModalHeaderProps & { requiredExtra: string }>
>().not.toExtend<SidebarHeaderSlot>();
// A component whose prop type conflicts with the slot's is rejected.
expectTypeOf<
  React.FC<Omit<CopilotChatInputProps, "mode"> & { mode: number }>
>().not.toExtend<ChatViewInputSlot>();
expectTypeOf<
  React.FC<Omit<CopilotModalHeaderProps, "title"> & { title: number }>
>().not.toExtend<SidebarHeaderSlot>();
// A non-component value is rejected.
expectTypeOf<number>().not.toExtend<ChatViewInputSlot>();
expectTypeOf<number>().not.toExtend<SidebarHeaderSlot>();
