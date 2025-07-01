import { AssistantMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";
import { useState } from "react";
import { TextMessage } from "@copilotkit/runtime-client-gql";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { icons, labels } = useChatContext();
  const {
    message,
    isLoading,
    subComponent,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    isCurrentMessage,
    rawData,
    markdownTagRenderers,
    canRegenerate = true,
    canCopy = true,
    index,
    disableFirstMessageControls
  } = props;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (message && onCopy) {
      navigator.clipboard.writeText(message);
      setCopied(true);
      onCopy(message);
      setTimeout(() => setCopied(false), 2000);
    } else if (message) {
      navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = () => {
    if (onRegenerate) {
      onRegenerate();
    }
  };

  const handleThumbsUp = () => {
    const fullMessage = rawData as TextMessage;
    if (onThumbsUp && fullMessage) {
      onThumbsUp(fullMessage);
    }
  };

  const handleThumbsDown = () => {
    const fullMessage = rawData as TextMessage;
    if (onThumbsDown && fullMessage) {
      onThumbsDown(fullMessage);
    }
  };

  const LoadingIcon = () => <span>{icons.activityIcon}</span>;

  return (
    <>
      {(message || isLoading) && (
        <div 
          className="copilotKitMessage copilotKitAssistantMessage"
          data-message-role="assistant"
          data-message-index={index}>
          {message && <Markdown content={message || ""} components={markdownTagRenderers} />}
          {isLoading && <LoadingIcon />}

          {!disableFirstMessageControls &&message && !isLoading && (
            <div
              className={`copilotKitMessageControls ${isCurrentMessage ? "currentMessage" : ""}`}
            >
              {canRegenerate && (
                <button
                  className="copilotKitMessageControlButton"
                  onClick={handleRegenerate}
                  aria-label={labels.regenerateResponse}
                  title={labels.regenerateResponse}
                >
                  {icons.regenerateIcon}
                </button>
              )}
              {canCopy && (
                <button
                  className="copilotKitMessageControlButton"
                  onClick={handleCopy}
                  aria-label={labels.copyToClipboard}
                  title={labels.copyToClipboard}
                >
                  {copied ? (
                    <span style={{ fontSize: "10px", fontWeight: "bold" }}>✓</span>
                  ) : (
                    icons.copyIcon
                  )}
                </button>
              )}
              {onThumbsUp && (
                <button
                  className="copilotKitMessageControlButton"
                  onClick={handleThumbsUp}
                  aria-label={labels.thumbsUp}
                  title={labels.thumbsUp}
                >
                  {icons.thumbsUpIcon}
                </button>
              )}
              {onThumbsDown && (
                <button
                  className="copilotKitMessageControlButton"
                  onClick={handleThumbsDown}
                  aria-label={labels.thumbsDown}
                  title={labels.thumbsDown}
                >
                  {icons.thumbsDownIcon}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
    </>
  );
};
