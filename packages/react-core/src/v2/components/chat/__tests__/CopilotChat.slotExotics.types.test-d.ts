// Verification assertions: exotic React components must remain valid slot values.
import { expectTypeOf } from "vitest";
import type React from "react";
import type { CopilotChatProps } from "../CopilotChat";
import type { CopilotChatViewProps } from "../CopilotChatView";
import type { CopilotChatInputProps } from "../CopilotChatInput";
import type { CopilotModalHeaderProps } from "../CopilotModalHeader";
import type { CopilotSidebarViewProps } from "../CopilotSidebarView";
import type { CopilotPopupViewProps } from "../CopilotPopupView";

type InputSlot = NonNullable<CopilotChatProps["input"]>;
type ChatViewInputSlot = NonNullable<CopilotChatViewProps["input"]>;
type SidebarHeaderSlot = NonNullable<CopilotSidebarViewProps["header"]>;
type PopupHeaderSlot = NonNullable<CopilotPopupViewProps["header"]>;
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
