import type {
  CopilotChatAssistantMessageProps,
  CopilotChatMessageViewProps,
} from "@copilotkit/react-core/v2";
import { useMemo } from "react";
import { useDesk } from "../lib/desk-store";

type AnswerParts = Parameters<
  NonNullable<CopilotChatAssistantMessageProps["children"]>
>[0];

/**
 * An agent turn: its markdown (with any generated views) in the desk's own
 * reading type, then its tool steps and toolbar. CopilotKit's default turn
 * wraps the markdown in a Tailwind prose preset with fixed grays; laying the
 * turn out here lets the typography come from the desk's tokens instead.
 */
function Answer({
  markdownRenderer,
  toolCallsView,
  toolbar,
  toolbarVisible,
}: AnswerParts) {
  return (
    <div className="copilotKitMessage copilotKitAssistantMessage answer">
      <div className="answer__text">{markdownRenderer}</div>
      {toolCallsView}
      {toolbarVisible && toolbar}
    </div>
  );
}

/** A reader turn: the question as typed, on a sand slip. */
function Question({ content }: { content: string }) {
  return <div className="question">{content}</div>;
}

/**
 * CopilotChat's message view, with the desk's turns. The thumbs on an answer
 * show once there are handlers for them; here they confirm in the status line.
 */
export function useMessageView(): Partial<CopilotChatMessageViewProps> {
  const { announce } = useDesk();
  return useMemo(
    () => ({
      assistantMessage: {
        children: Answer,
        onThumbsUp: () => announce("Thanks, noted as helpful"),
        onThumbsDown: () => announce("Thanks, noted as not helpful"),
      },
      userMessage: { messageRenderer: Question },
    }),
    [announce],
  );
}
