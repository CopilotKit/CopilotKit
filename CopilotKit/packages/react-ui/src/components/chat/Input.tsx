import React, { useEffect, useRef, useState } from "react";
import { InputProps } from "./props";
import { useChatContext } from "./ChatContext";
import AutoResizingTextarea from "./Textarea";
import { usePushToTalk } from "../../hooks/use-push-to-talk";
import { useCopilotContext } from "@copilotkit/react-core";

export const Input = ({ inProgress, onSend, isVisible = false }: InputProps) => {
  const context = useChatContext();
  const copilotContext = useCopilotContext();

  const pushToTalkConfigured =
    copilotContext.copilotApiConfig.textToSpeechUrl !== undefined &&
    copilotContext.copilotApiConfig.transcribeAudioUrl !== undefined;

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

  const sendIcon =
    inProgress || pushToTalkState === "transcribing"
      ? context.icons.activityIcon
      : context.icons.sendIcon;
  const showPushToTalk =
    pushToTalkConfigured &&
    (pushToTalkState === "idle" || pushToTalkState === "recording") &&
    !inProgress;
  const sendDisabled = inProgress || text.length === 0 || pushToTalkState !== "idle";

  return (
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
            send();
          }
        }}
      />
      <div className="copilotKitInputControls">
        {showPushToTalk && (
          <button
            onClick={() =>
              setPushToTalkState(pushToTalkState === "idle" ? "recording" : "transcribing")
            }
            className={pushToTalkState === "recording" ? "copilotKitPushToTalkRecording" : ""}
          >
            {context.icons.pushToTalkIcon}
          </button>
        )}
        <button disabled={sendDisabled} onClick={send}>
          {sendIcon}
        </button>
      </div>
    </div>
  );
};
