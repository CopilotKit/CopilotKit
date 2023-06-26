import { type Message } from 'ai'

import { Separator } from '@/components/ui/separator'
import { ChatMessage } from '@/components/chat-message'

export interface ChatList {
  messages: Message[]
}

export function ChatList({ messages }: ChatList) {
  // we don't want to display system messages
  const displayedMessages = messages.filter(
    message => message.role !== 'system'
  )

  if (!displayedMessages.length) {
    return null
  }

  return (
    <div className="relative mx-auto max-w-2xl px-0">
      {displayedMessages.map((message, index) => (
        <div key={index}>
          <ChatMessage message={message} />
          {index < displayedMessages.length - 1 && (
            <Separator className="my-4 md:my-4" />
          )}
        </div>
      ))}
    </div>
  )
}
