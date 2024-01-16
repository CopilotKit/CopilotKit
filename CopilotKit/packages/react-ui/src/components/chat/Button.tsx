import React from "react";
import { ButtonProps } from "./props";
import { useTemporaryContext } from "./TemporaryContext";

export const Button: React.FC<ButtonProps> = ({ open, setOpen }) => {
  const context = useTemporaryContext();
  // To ensure that the mouse handler fires even when the button is scaled down
  // we wrap the button in a div and attach the handler to the div
  return (
    <div onClick={() => setOpen(!open)}>
      <button
        className={`copilotKitButton ${open ? "open" : ""}`}
        aria-label={open ? "Close Chat" : "Open Chat"}
      >
        <div className="copilotKitButtonIcon copilotKitButtonIconOpen">
          {context.icons.openIcon}
        </div>
        <div className="copilotKitButtonIcon copilotKitButtonIconClose">
          {context.icons.closeIcon}
        </div>
      </button>
    </div>
  );
};
