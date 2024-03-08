import React, { useEffect, useRef, useState } from "react";
import { InputProps } from "./props";
import { useChatContext } from "./ChatContext";
import AutoResizingTextarea from "./Textarea";

export const Input = ({ inProgress, onSend, children, isVisible = false }: InputProps) => {
  const context = useChatContext();
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

  const icon = inProgress ? context.icons.activityIcon : context.icons.sendIcon;
  const disabled = inProgress || text.length === 0;

  return (
    <div className="copilotKitInput" onClick={handleDivClick}>
      <span>{children}</span>
      <button className="copilotKitSendButton" disabled={disabled} onClick={send}>
        {icon}
      </button>
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
    </div>
  );
};
