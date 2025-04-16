import React, { useEffect, useRef, useState } from "react";
import { InputProps } from "./props";
import { useChatContext } from "./ChatContext";
import AutoResizingTextarea from "./Textarea";
import { usePushToTalk } from "../../hooks/use-push-to-talk";
import { useCopilotContext } from "@copilotkit/react-core";

export const Input = ({ inProgress, onSend, isVisible = false, onStop, onUpload }: InputProps) => {
  const context = useChatContext();
  const copilotContext = useCopilotContext();

  const pushToTalkConfigured =
    copilotContext.copilotApiConfig.textToSpeechUrl !== undefined &&
    copilotContext.copilotApiConfig.transcribeAudioUrl !== undefined;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleDivClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    // If the user clicked a button or inside a button, don't focus the textarea
    if (target.closest("button")) return;

    // If the user clicked the textarea, do nothing (it's already focused)
    if (target.tagName === "TEXTAREA") return;

    // Otherwise, focus the textarea
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
    pushToTalkConfigured &&
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
          {onUpload && (
            <button onClick={onUpload} className="copilotKitInputControlButton">
              {context.icons.uploadIcon}
            </button>
          )}

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
