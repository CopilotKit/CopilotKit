import { ErrorMessageProps } from "../props";
import { useChatContext } from "../ChatContext";
import { Markdown } from "../Markdown";
import { useState } from "react";
import { copyToClipboard } from "@copilotkit/shared";

export const ErrorMessage = (props: ErrorMessageProps) => {
  const { icons, labels } = useChatContext();
  const { error, onRegenerate, onCopy, isCurrentMessage } = props;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const content = error.message;
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

  console.log(error);

  return (
    <div className="copilotKitMessage copilotKitAssistantMessage">
      <Markdown content={error.message} />

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
      </div>
    </div>
  );
};
