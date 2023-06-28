'use client'

import { useChat, type Message } from 'ai/react'

import { cn } from '@/lib/utils'
import { ChatList } from '@/chat-components/chat-list'
import { ChatPanel } from '@/chat-components/chat-panel'
import { EmptyScreen } from '@/chat-components/empty-screen'
import { ChatScrollAnchor } from '@/chat-components/chat-scroll-anchor'
import { toast } from 'react-hot-toast'
import { CopilotContext } from '@/app/CopilotContext'
import { useContext, useEffect, useMemo } from 'react'

export interface ChatProps extends React.ComponentProps<'div'> {
  initialMessages?: Message[]
  id?: string
  makeSystemMessage?: (contextString: string) => string
}

export function Chat({
  id,
  initialMessages,
  className,
  makeSystemMessage
}: ChatProps) {
  const { getContextString } = useContext(CopilotContext)
  const contextString = getContextString()
  const usedMakeSystemMessage = makeSystemMessage || defaultSystemMessage

  const systemMessage: Message = useMemo(() => {
    return {
      id: 'system',
      content: usedMakeSystemMessage(contextString),
      role: 'system'
    }
  }, [contextString, usedMakeSystemMessage])

  const initialMessagesWithContext = [systemMessage].concat(
    initialMessages || []
  )

  const { messages, append, reload, stop, isLoading, input, setInput } =
    useChat({
      initialMessages: initialMessagesWithContext,
      id,
      body: {
        id,
        previewToken
      },
      onResponse(response) {
        if (response.status === 401) {
          toast.error(response.statusText)
        }
      }
    })

  return (
    <div className="bg-green-200 h-full w-full">
      {/* <div className={cn('pb-[200px] pt-4', className)}>
        {messages.length ? (
          <>
            <ChatList messages={messages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div> */}
      {/* <ChatPanel
        id={id}
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
      /> */}
    </div>
  )
}

const previewToken = 'TODO123'

export function defaultSystemMessage(contextString: string): string {
  return `
Please act as a competent and conscientious professional assistant.

The user has provided you with the following context:
\`\`\`
${contextString}
\`\`\`

They have also provided you with functions you can call to initiate actions on their behalf, or functions you can call to receive more information.

Please assist them as best you can.
If you are not sure how to proceed to best fulfill their requests, please ask them for more information.
`
}
