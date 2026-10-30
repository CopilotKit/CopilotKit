import {
  CopilotChatUserMessage,
  UseAgentUpdate,
  useAgent,
} from "@copilotkit/react-core/v2";
import type {
  CopilotChatAssistantMessageProps,
  CopilotChatMessageViewProps,
  CopilotChatUserMessageProps,
} from "@copilotkit/react-core/v2";
import { useMemo } from "react";
import { AGENT_ID } from "../lib/agent";
import { useDesk } from "../lib/desk-store";
import type { ViewKind } from "../lib/view-catalog";
import { requestedView } from "../lib/view-request-messages";

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
function Question({ content, view }: { content: string; view?: ViewKind }) {
  const label = view ? `Requested ${view.label.toLowerCase()} view` : undefined;
  return (
    <div className="question" data-view={view?.id}>
      {content}
      {view && (
        <span
          className="question__view"
          style={{ color: view.tone }}
          role="img"
          aria-label={label}
          title={label}
        >
          <view.icon size={16} strokeWidth={1.75} aria-hidden />
        </span>
      )}
    </div>
  );
}

/** Keep the SDK's attachments and toolbar while giving the bubble its marker. */
function QuestionMessage(props: CopilotChatUserMessageProps) {
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  // The SDK memoizes user rows by content, so metadata added just before a run
  // can leave the slot's message prop stale. Read the canonical turn by ID.
  const message = agent.messages.find((item) => item.id === props.message.id);
  const view = requestedView(message ?? props.message);
  const messageRenderer = useMemo(
    () => (parts: { content: string }) => <Question {...parts} view={view} />,
    [view],
  );
  return (
    <CopilotChatUserMessage {...props} messageRenderer={messageRenderer} />
  );
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
      userMessage: QuestionMessage as typeof CopilotChatUserMessage,
    }),
    [announce],
  );
}
