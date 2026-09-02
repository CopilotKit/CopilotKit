"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import {
  useStageBuildCar,
  useStageGetContactInfo,
  useStageGetPaymentInfo,
  useStageConfirmOrder,
  useStageSellFinancing,
  useStageGetFinancingInfo,
} from "@/lib/stages";

import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import { UserMessage, AssistantMessage } from "./chat-message";

export interface ChatProps {
  className?: string;
}

const initialMessage =
  "Hi, I'm Fio, your AI car salesman. First, let's get your contact information before we get started.";

export function CarSalesChat({ className }: ChatProps) {
  const { agent, isReady } = useAgent({ agentId: "default" });
  const initialMessageSent = useRef(false);

  // Add the stages of the state machine
  useStageGetContactInfo();
  useStageBuildCar();
  useStageSellFinancing();
  useStageGetPaymentInfo();
  useStageGetFinancingInfo();
  useStageConfirmOrder();

  // Render an initial message when the chat is first loaded
  useEffect(() => {
    if (initialMessageSent.current || !isReady || agent.isRunning) return;

    if (agent.messages.length > 0) {
      initialMessageSent.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      if (agent.messages.length > 0) {
        initialMessageSent.current = true;
        return;
      }

      agent.addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: initialMessage,
      });
      initialMessageSent.current = true;
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [agent, agent.isRunning, isReady]);

  return (
    <div
      className={cn(
        "flex flex-col h-full max-h-full w-full rounded-xl shadow-sm border border-neutral-200",
        className,
      )}
    >
      <div className={cn("flex-1 w-full rounded-xl overflow-y-auto")}>
        <CopilotChat
          className="h-full w-full"
          agentId="default"
          messageView={{
            userMessage: {
              children: ({ message }) => <UserMessage message={message} />,
            },
            assistantMessage: {
              children: ({
                message,
                messages,
                isRunning,
                markdownRenderer,
                toolCallsView,
              }) => (
                <AssistantMessage
                  message={message}
                  messages={messages}
                  isRunning={isRunning}
                  markdownRenderer={markdownRenderer}
                  toolCallsView={toolCallsView}
                />
              ),
            },
          }}
        />
      </div>
    </div>
  );
}
