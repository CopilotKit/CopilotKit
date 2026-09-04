"use client";

import { cn } from "@/lib/utils/cn";
import {
  useStageBuildCar,
  useStageGetContactInfo,
  useStageGetPaymentInfo,
  useStageConfirmOrder,
  useStageSellFinancing,
  useStageGetFinancingInfo,
} from "@/lib/stages";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { UserMessage, AssistantMessage } from "./chat-message";

export interface ChatProps {
  className?: string;
}

const initialMessage =
  "Hi, I'm Fio, your AI car salesman. First, let's get your contact information before we get started.";

export function CarSalesChat({ className }: ChatProps) {
  // Add the stages of the state machine
  useStageGetContactInfo();
  useStageBuildCar();
  useStageSellFinancing();
  useStageGetPaymentInfo();
  useStageGetFinancingInfo();
  useStageConfirmOrder();

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
          labels={{ welcomeMessageText: initialMessage }}
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
