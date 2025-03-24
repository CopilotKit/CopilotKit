import React, { useEffect, useRef, useState } from "react";
import { InputProps } from "./props";
import { useChatContext } from "./ChatContext";
import AutoResizingTextarea from "./Textarea";
import { usePushToTalk } from "../../hooks/use-push-to-talk";
import { useCopilotContext } from "@copilotkit/react-core";

export const Input = ({ inProgress, onSend, isVisible = false, onStop }: InputProps) => {
  const context = useChatContext();
  const copilotContext = useCopilotContext();

  const speechToTextConfigured = copilotContext.copilotApiConfig.transcribeAudioUrl !== undefined;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleDivClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Check if the clicked element is not the textarea itself
    if (event.target !== event.currentTarget) return;

    textareaRef.current?.focus();
  };

  const [text, setText] = useState("");
  const send = () => {
    if (inProgress) return;
    onSend(text);
    setText("");

    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (isVisible) {
      textareaRef.current?.focus();
    }
  }, [isVisible]);

  const { pushToTalkState, setPushToTalkState } = usePushToTalk({
    sendFunction: onSend,
    inProgress,
  });

  const isInProgress = inProgress || pushToTalkState === "transcribing";
  const buttonIcon = isInProgress ? context.icons.stopIcon : context.icons.sendIcon;
  const showPushToTalk =
    speechToTextConfigured &&
    (pushToTalkState === "idle" || pushToTalkState === "recording") &&
    !inProgress;

  const canSend = () => {
    const interruptEvent = copilotContext.langGraphInterruptAction?.event;
    const interruptInProgress =
      interruptEvent?.name === "LangGraphInterruptEvent" && !interruptEvent?.response;

    return (
      (isInProgress || (!isInProgress && text.trim().length > 0)) &&
      pushToTalkState === "idle" &&
      !interruptInProgress
    );
  };

  const sendDisabled = !canSend();

  return (
    <div className="copilotKitInputContainer">
      <div className="copilotKitInput" onClick={handleDivClick}>
        <AutoResizingTextarea
          ref={textareaRef}
          placeholder={context.labels.placeholder}
          autoFocus={true}
          maxRows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend()) {
                send();
              }
            }
          }}
        />
        <div className="copilotKitInputControls">
          <div style={{ flexGrow: 1 }} />
          {showPushToTalk && (
            <button
              onClick={() =>
                setPushToTalkState(pushToTalkState === "idle" ? "recording" : "transcribing")
              }
              className={
                pushToTalkState === "recording"
                  ? "copilotKitInputControlButton copilotKitPushToTalkRecording"
                  : "copilotKitInputControlButton"
              }
            >
              {context.icons.pushToTalkIcon}
            </button>
          )}
          <button
            disabled={sendDisabled}
            onClick={isInProgress ? onStop : send}
            data-copilotkit-in-progress={inProgress}
            data-test-id={inProgress ? "copilot-chat-request-in-progress" : "copilot-chat-ready"}
            className="copilotKitInputControlButton"
          >
            {buttonIcon}
          </button>
        </div>
      </div>
    </div>
  );
};
