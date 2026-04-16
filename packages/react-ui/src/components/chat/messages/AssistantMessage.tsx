import { AssistantMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";
import { useState } from "react";
import React from "react";
import { copyToClipboard } from "@copilotkit/shared";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { icons, labels } = useChatContext();
  const {
    message,
    isLoading,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    isCurrentMessage,
    feedback,
    markdownTagRenderers,
  } = props;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const content = message?.content || "";
    if (!content) return;

    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      if (onCopy) onCopy(content);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = () => {
    if (onRegenerate) onRegenerate();
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
  const content = message?.content || "";
  const subComponent = message?.generativeUI?.() ?? props.subComponent;
  const subComponentPosition = message?.generativeUIPosition ?? "after";
  const renderBefore = subComponent && subComponentPosition === "before";
  const renderAfter = subComponent && subComponentPosition !== "before";

  return (
    <>
      {renderBefore ? (
        <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
      ) : null}
      {content && (
        <div className="copilotKitMessage copilotKitAssistantMessage">
          {content && (
            <Markdown content={content} components={markdownTagRenderers} />
          )}

          {content && !isLoading && (
            <div
              className={`copilotKitMessageControls ${isCurrentMessage ? "currentMessage" : ""}`}
            >
              <button
                className="copilotKitMessageControlButton"
                onClick={handleRegenerate}
                aria-label={labels.regenerateResponse}
                title={labels.regenerateResponse}
              >
                {icons.regenerateIcon}
              </button>
              <button
                className="copilotKitMessageControlButton"
                onClick={handleCopy}
                aria-label={labels.copyToClipboard}
                title={labels.copyToClipboard}
              >
                {copied ? (
                  <span style={{ fontSize: "10px", fontWeight: "bold" }}>
                    ✓
                  </span>
                ) : (
                  icons.copyIcon
                )}
              </button>
              {onThumbsUp && (
                <button
                  className={`copilotKitMessageControlButton ${
                    feedback === "thumbsUp" ? "active" : ""
                  }`}
                  onClick={handleThumbsUp}
                  aria-label={labels.thumbsUp}
                  title={labels.thumbsUp}
                >
                  {icons.thumbsUpIcon}
                </button>
              )}
              {onThumbsDown && (
                <button
                  className={`copilotKitMessageControlButton ${
                    feedback === "thumbsDown" ? "active" : ""
                  }`}
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
      {renderAfter ? (
        <div style={{ marginBottom: "0.5rem" }}>{subComponent}</div>
      ) : null}
      {isLoading && <LoadingIcon />}
    </>
  );
};
