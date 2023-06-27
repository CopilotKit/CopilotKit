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
}

const previewToken = 'TODO123'

export function Chat({ id, initialMessages, className }: ChatProps) {
  const { getContextString } = useContext(CopilotContext)
  const contextString = useMemo(getContextString, [getContextString])
  const systemMessage: Message = useMemo(() => {
    return {
      id: 'system',
      content: contextString,
      role: 'system'
    }
  }, [contextString])

  useEffect(() => {
    console.log('systemMessage', systemMessage)
  }, [systemMessage])

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
    <>
      <div className={cn('pb-[200px] pt-4', className)}>
        {messages.length ? (
          <>
            <ChatList messages={messages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>
      <ChatPanel
        id={id}
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
      />
    </>
  )
}
