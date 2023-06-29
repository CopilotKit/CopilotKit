'use client'

import { useChat, type Message } from 'ai/react'

import { ChatList } from '@/chat-components/chat-list'
import { ChatPanel } from '@/chat-components/chat-panel'
import {
  DefaultEmptyScreen,
  EmptyScreenProps
} from '@/chat-components/default-empty-screen'
import { ChatScrollAnchor } from '@/chat-components/chat-scroll-anchor'
import { toast } from 'react-hot-toast'
import { CopilotContext } from '@/app/copilot-context'
import { useContext, useEffect, useMemo } from 'react'

export interface ChatProps extends React.ComponentProps<'div'> {
  initialMessages?: Message[]
  id?: string
  makeSystemMessage?: (contextString: string) => string
}

interface ChatComponentInjectionsProps {
  EmptyScreen?: React.ComponentType<EmptyScreenProps>
}

export function Chat({
  id,
  initialMessages,
  makeSystemMessage,
  EmptyScreen = DefaultEmptyScreen
}: ChatProps & ChatComponentInjectionsProps) {
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

  const visibleMessages = messages.filter(
    message => message.role === 'user' || message.role === 'assistant'
  )

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box', // ensure padding is included in total height
        alignItems: 'flex-start' // prevent stretching of items
      }}
    >
      <div
        className="pt-5 px-5"
        style={{
          overflowY: 'auto',
          overflowX: 'hidden',
          width: '100%',
          flexGrow: 1
        }}
      >
        {visibleMessages.length ? (
          <div className="pl-0 pr-6">
            <ChatList messages={visibleMessages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </div>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>

      <div style={{ flexShrink: 0, width: '100%' }}>
        <ChatPanel
          id={id}
          isLoading={isLoading}
          stop={stop}
          append={append}
          reload={reload}
          messages={visibleMessages}
          input={input}
          setInput={setInput}
        />
      </div>
    </div>
  )
}

const previewToken = 'TODO123'

export function defaultSystemMessage(contextString: string): string {
  return `
Please act as a efficient, competent, and conscientious professional assistant.
You help the user achieve their goals, and you do so in a way that is as efficient as possible, without unnecessary fluff, but also without sacrificing professionalism.
Always be polite and respectful, and prefer brevity over verbosity.

The user has provided you with the following context:
\`\`\`
${contextString}
\`\`\`

They have also provided you with functions you can call to initiate actions on their behalf, or functions you can call to receive more information.

Please assist them as best you can.
If you are not sure how to proceed to best fulfill their requests, please ask them for more information.
`
}
