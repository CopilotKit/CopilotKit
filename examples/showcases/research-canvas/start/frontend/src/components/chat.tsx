'use client'

import { INITIAL_MESSAGE, MAIN_CHAT_INSTRUCTIONS, MAIN_CHAT_TITLE } from "@/lib/consts";

export default function Chat({ onSubmitMessage }: { onSubmitMessage: () => void }) {
  return (
    <h1 className="text-2xl font-bold flex items-center justify-center h-full mx-auto mr-20">
        It'd be really cool if we had chat here!
    </h1>
  )
}