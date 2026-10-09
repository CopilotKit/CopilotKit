// Type-only assertions for #7126. `tsc --noEmit` is the only consumer — this
// file is not in vitest's `*.{test,spec}.{ts,tsx}` include glob.
//
// chatView is SlotValue<React.ComponentType<CopilotChatViewProps>>, so a plain
// FC / call signature assigns without CopilotChatView namespace statics
// (WelcomeScreen, ScrollView, …) and without Object.assign or a cast.
import { expectTypeOf } from "vitest";
import type React from "react";
import type { CopilotChatProps } from "../CopilotChat";
import type { CopilotChatViewProps } from "../CopilotChatView";
import { CopilotChatView } from "../CopilotChatView";

type ChatViewSlot = NonNullable<CopilotChatProps["chatView"]>;

type CustomChatView = React.FC<CopilotChatViewProps>;
type CustomChatViewFn = (props: CopilotChatViewProps) => React.ReactNode;

expectTypeOf<CustomChatView>().toExtend<ChatViewSlot>();
expectTypeOf<CustomChatViewFn>().toExtend<ChatViewSlot>();
expectTypeOf<typeof CopilotChatView>().toExtend<ChatViewSlot>();
expectTypeOf<string>().toExtend<ChatViewSlot>();
expectTypeOf<Partial<CopilotChatViewProps>>().toExtend<ChatViewSlot>();
