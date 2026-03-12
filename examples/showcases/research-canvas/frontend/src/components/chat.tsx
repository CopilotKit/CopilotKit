'use client'

import { CopilotChat } from "@copilotkit/react-ui";
import { INITIAL_MESSAGE, MAIN_CHAT_INSTRUCTIONS, MAIN_CHAT_TITLE } from "@/lib/consts";
// TODO: fix
// @ts-expect-error -- ignore
import { CopilotChatProps } from "@copilotkit/react-ui/dist/components/chat/Chat";

export default function Chat(props: CopilotChatProps) {
  return (
      <CopilotChat
          instructions={MAIN_CHAT_INSTRUCTIONS}
          labels={{
              title: MAIN_CHAT_TITLE,
              initial: INITIAL_MESSAGE,
          }}
          className="h-full w-full font-noto"
          {...props}
      />
  )
}
