import { AssistantMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";
import React, { useState } from "react";
import { useCopilotContext } from "@copilotkit/react-core";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { icons, labels } = useChatContext();
  const { chatComponentsCache } = useCopilotContext();
  const {
    message,
    isLoading,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    isCurrentMessage,
    markdownTagRenderers,
  } = props;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const content = message?.content || "";
    if (content && onCopy) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy(content);
      setTimeout(() => setCopied(false), 2000);
    } else if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = () => {
    if (onRegenerate) onRegenerate();
  };

  const handleThumbsUp = () => {
    if (onThumbsUp && message) onThumbsUp(message);
  };

  const handleThumbsDown = () => {
    if (onThumbsDown && message) onThumbsDown(message);
  };

  const LoadingIcon = () => <span>{icons.activityIcon}</span>;
  const content = message?.content || "";

  const cachedActions = chatComponentsCache?.current?.actions;
  const actionName = typeof message?.name === "string" ? message.name : undefined;
  const toRender = (actionName && cachedActions?.[actionName]) ?? cachedActions?.["*"] ?? undefined;
  const subComponentProps = message?.generativeUIProps?.();
  let subComponent: React.ReactNode = undefined;
  if (toRender) {
    if (React.isValidElement(toRender)) {
      subComponent = toRender;
    } else if (typeof toRender === "function") {
      const Comp = toRender as React.ComponentType<any>;
      subComponent = <Comp {...subComponentProps} />;
    } else {
      // Fallback for agent state (and any other) messages that rely on message.generativeUI
      subComponent = message?.generativeUI?.();
    }
  }
  return (
    <>
      {content && (
        <div className="copilotKitMessage copilotKitAssistantMessage">
          {content && <Markdown content={content} components={markdownTagRenderers} />}

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
                  <span style={{ fontSize: "10px", fontWeight: "bold" }}>✓</span>
                ) : (
                  icons.copyIcon
                )}
              </button>
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
      {isLoading && <LoadingIcon />}
    </>
  );
};
