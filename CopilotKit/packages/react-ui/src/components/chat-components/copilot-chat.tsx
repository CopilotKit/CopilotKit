"use client";

import React from "react";

import { ChatList } from "./chat-list";
import { ChatPanel } from "./chat-panel";
import { DefaultEmptyScreen, EmptyScreenProps } from "./default-empty-screen";
import { ChatScrollAnchor } from "./chat-scroll-anchor";
import { UseCopilotChatOptions, useCopilotChat } from "@copilotkit/react-core";

interface ChatComponentInjectionsProps {
  EmptyScreen?: React.FC<EmptyScreenProps>;
}

interface CopilotChatProps extends UseCopilotChatOptions, ChatComponentInjectionsProps {}

export function CopilotChat({
  id,
  initialMessages,
  makeSystemMessage,
  EmptyScreen = DefaultEmptyScreen,
}: CopilotChatProps) {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id,
    initialMessages,
    makeSystemMessage,
  });

  return (
    <div className="w-full h-full flex flex-col overflow-hidden box-border items-start">
      <div className="pt-5 px-5 overflow-y-auto overflow-x-hidden w-full flex-grow">
        {visibleMessages.length ? (
          <div className="pl-0 pr-6">
            <ChatList messages={visibleMessages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </div>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>

      <div className="flex-shrink-0 w-full">
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
  );
}
