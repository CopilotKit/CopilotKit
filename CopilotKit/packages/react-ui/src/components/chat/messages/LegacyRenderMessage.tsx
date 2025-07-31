import React from "react";
import { RenderMessageProps } from "../props";
import { RenderMessage as DefaultRenderMessage } from "./RenderMessage";
import { aguiToGQL } from "@copilotkit/runtime-client-gql";

/**
 * Legacy message render props interface for backwards compatibility
 */
export interface LegacyRenderProps {
  RenderTextMessage?: React.ComponentType<RenderMessageProps>;
  RenderActionExecutionMessage?: React.ComponentType<RenderMessageProps>;
  RenderAgentStateMessage?: React.ComponentType<RenderMessageProps>;
  RenderResultMessage?: React.ComponentType<RenderMessageProps>;
  RenderImageMessage?: React.ComponentType<RenderMessageProps>;
}

/**
 * Props for the LegacyRenderMessage component
 */
export interface LegacyRenderMessageProps extends RenderMessageProps {
  legacyProps: LegacyRenderProps;
}

/**
 * Legacy message adapter component that maps old render props to new message types.
 * This component provides backwards compatibility for the deprecated render props.
 */
export const LegacyRenderMessage: React.FC<LegacyRenderMessageProps> = ({
  message,
  inProgress,
  index,
  isCurrentMessage,
  actionResult,
  AssistantMessage,
  UserMessage,
  ImageRenderer,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  markdownTagRenderers,
  legacyProps,
}) => {
  const {
    RenderTextMessage,
    RenderActionExecutionMessage,
    RenderAgentStateMessage,
    RenderResultMessage,
    RenderImageMessage,
  } = legacyProps;

  const deprecatedMessage = aguiToGQL(message)[0] ?? undefined;

  // Route to appropriate legacy renderer based on message type
  if (deprecatedMessage.isTextMessage() && RenderTextMessage) {
    return (
      <RenderTextMessage
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        onRegenerate={onRegenerate}
        onCopy={onCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        markdownTagRenderers={markdownTagRenderers}
      />
    );
  }

  if (deprecatedMessage.isActionExecutionMessage() && RenderActionExecutionMessage) {
    return (
      <RenderActionExecutionMessage
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        actionResult={actionResult}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
      />
    );
  }

  if (deprecatedMessage.isAgentStateMessage() && RenderAgentStateMessage) {
    return (
      <RenderAgentStateMessage
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
      />
    );
  }

  if (deprecatedMessage.isResultMessage() && RenderResultMessage) {
    return (
      <RenderResultMessage
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
      />
    );
  }

  if (deprecatedMessage.isImageMessage() && RenderImageMessage) {
    return (
      <RenderImageMessage
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
      />
    );
  }

  // Fallback to default RenderMessage for any unhandled cases
  return (
    <DefaultRenderMessage
      message={message}
      inProgress={inProgress}
      index={index}
      isCurrentMessage={isCurrentMessage}
      AssistantMessage={AssistantMessage}
      UserMessage={UserMessage}
      ImageRenderer={ImageRenderer}
      onRegenerate={onRegenerate}
      onCopy={onCopy}
      onThumbsUp={onThumbsUp}
      onThumbsDown={onThumbsDown}
      markdownTagRenderers={markdownTagRenderers}
    />
  );
};
