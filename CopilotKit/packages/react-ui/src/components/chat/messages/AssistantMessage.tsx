import { AssistantMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";
import { RegenerateIcon, CopyIcon, ThumbsUpIcon, ThumbsDownIcon } from "../Icons";
import { useState } from "react";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { icons, labels } = useChatContext();
  const { message, isLoading, subComponent, onRegenerate, onCopy, onThumbsUp, onThumbsDown, isCurrentMessage } =
    props;
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
    if (onThumbsUp && message) {
      onThumbsUp(message);
    }
  };

  const handleThumbsDown = () => {
    if (onThumbsDown && message) {
      onThumbsDown(message);
    }
  };

  const LoadingIcon = () => <span>{icons.activityIcon}</span>;

  return (
    <>
      {(message || isLoading) && (
        <div className="copilotKitMessage copilotKitAssistantMessage">
          {message && <Markdown content={message || ""} />}
          {isLoading && <LoadingIcon />}

          {message && !isLoading && (
            <div className={`copilotKitMessageControls ${isCurrentMessage ? 'currentMessage' : ''}`}>
              <button
                className="copilotKitMessageControlButton"
                onClick={handleRegenerate}
                aria-label={labels.regenerateResponse}
                title={labels.regenerateResponse}
              >
                {RegenerateIcon}
              </button>
              <button
                className="copilotKitMessageControlButton"
                onClick={handleCopy}
                aria-label={labels.copyToClipboard}
                title={labels.copyToClipboard}
              >
                {copied ? (
                  <span style={{ fontSize: "10px", fontWeight: "bold" }}>✓</span>
                ) : (
                  CopyIcon
                )}
              </button>
              {onThumbsUp && (
                  <button
                      className="copilotKitMessageControlButton"
                      onClick={handleThumbsUp}
                      aria-label={labels.thumbsUp}
                      title={labels.thumbsUp}
                  >
                    {ThumbsUpIcon}
                  </button>
              )}
              {onThumbsDown && (
                  <button
                      className="copilotKitMessageControlButton"
                      onClick={handleThumbsDown}
                      aria-label={labels.thumbsDown}
                      title={labels.thumbsDown}
                  >
                    {ThumbsDownIcon}
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
