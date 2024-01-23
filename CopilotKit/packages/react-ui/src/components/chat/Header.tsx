import React from "react";
import { HeaderProps } from "./props";
import { useChatContext } from "./ChatContext";

export const Header: React.FC<HeaderProps> = ({ setOpen }) => {
  const context = useChatContext();

  return (
    <div className="copilotKitHeader">
      <div>{context.labels.title}</div>
      <button onClick={() => setOpen(false)} aria-label="Close">
        {context.icons.headerCloseIcon}
      </button>
    </div>
  );
};
