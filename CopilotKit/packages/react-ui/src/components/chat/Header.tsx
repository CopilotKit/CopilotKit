import React from "react";
import { HeaderProps } from "./props";
import { useTemporaryContext } from "./TemporaryContext";

export const Header: React.FC<HeaderProps> = ({ setOpen }) => {
  const context = useTemporaryContext();

  return (
    <div className="copilotKitHeader">
      <div>{context.labels.title}</div>
      <button onClick={() => setOpen(false)} aria-label="Close">
        {context.icons.headerCloseIcon}
      </button>
    </div>
  );
};
