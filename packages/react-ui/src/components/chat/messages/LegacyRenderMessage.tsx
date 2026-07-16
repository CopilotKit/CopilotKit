import React from "react";
import type { RenderMessageProps } from "../props";
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
  messages,
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
  showTimestamps,
  formatTimestamp,
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
        messages={messages}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        onRegenerate={onRegenerate}
        onCopy={onCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
        markdownTagRenderers={markdownTagRenderers}
      />
    );
  }

  if (
    deprecatedMessage.isActionExecutionMessage() &&
    RenderActionExecutionMessage
  ) {
    return (
      <RenderActionExecutionMessage
        messages={messages}
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        actionResult={actionResult}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
      />
    );
  }

  if (deprecatedMessage.isAgentStateMessage() && RenderAgentStateMessage) {
    return (
      <RenderAgentStateMessage
        messages={messages}
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
      />
    );
  }

  if (deprecatedMessage.isResultMessage() && RenderResultMessage) {
    return (
      <RenderResultMessage
        messages={messages}
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
      />
    );
  }

  if (deprecatedMessage.isImageMessage() && RenderImageMessage) {
    return (
      <RenderImageMessage
        messages={messages}
        message={message}
        inProgress={inProgress}
        index={index}
        isCurrentMessage={isCurrentMessage}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
      />
    );
  }

  // Fallback to default RenderMessage for any unhandled cases
  return (
    <DefaultRenderMessage
      messages={messages}
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
      showTimestamps={showTimestamps}
      formatTimestamp={formatTimestamp}
      markdownTagRenderers={markdownTagRenderers}
    />
  );
};
