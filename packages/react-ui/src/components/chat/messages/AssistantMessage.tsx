/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — AssistantMessage:
 *   V2 import and usage:
 *     import { AssistantMessage } from "@copilotkit/react-core/v2";
 *     const v2AssistantMessage = AssistantMessage;
 *   V2 replacement source: packages/react-core/src/v2/index.ts
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { AssistantMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";
import { useState } from "react";
import React from "react";
import { copyToClipboard } from "@copilotkit/shared";
import { MessageTimestamp } from "./MessageTimestamp";
import { isActivatingClick } from "../feedback";

export const AssistantMessage = (props: AssistantMessageProps) => {
  const { icons, labels, showTimestamps } = useChatContext();
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

  // Clicking the already-active button retracts the feedback, so report the
  // state the click transitions to rather than an unconditional `true`.
  const handleThumbsUp = () => {
    if (onThumbsUp && message) {
      onThumbsUp(message, isActivatingClick(feedback, "thumbsUp"));
    }
  };

  const handleThumbsDown = () => {
    if (onThumbsDown && message) {
      onThumbsDown(message, isActivatingClick(feedback, "thumbsDown"));
    }
  };

  const LoadingIcon = () => (
    <span data-testid="copilot-loading-cursor">{icons.activityIcon}</span>
  );
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

          {showTimestamps && (
            <MessageTimestamp timestamp={message?.timestamp} />
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
