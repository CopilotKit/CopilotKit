import React, { useState } from "react";
import { CopilotKitChat, CopilotKitChatProps } from "./Chat";

interface CopilotKitSidebarProps extends CopilotKitChatProps {
  children?: React.ReactNode;
}

export const CopilotKitSidebar: React.FC<CopilotKitSidebarProps> = (props) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitSidebar" : "copilotKitSidebar",
  };
  const [expandedClassName, setExpandedClassName] = useState(
    props.defaultOpen ? "sidebarExpanded" : "",
  );

  const onSetOpen = (open: boolean) => {
    // TODO: call onSetOpen
    // props.onSetOpen?.(open);
    setExpandedClassName(open ? "sidebarExpanded" : "");
  };

  props.onSetOpen = onSetOpen;

  return (
    <div className={`copilotKitSidebarContentWrapper ${expandedClassName}`}>
      {props.children}
      <CopilotKitChat {...props} />
    </div>
  );
};
