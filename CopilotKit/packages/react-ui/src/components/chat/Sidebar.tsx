import React, { useState } from "react";
import { CopilotKitChat, CopilotKitChatProps } from "./Chat";

interface CopilotSidebarProps extends CopilotKitChatProps {
  children?: React.ReactNode;
}

export const CopilotSidebar: React.FC<CopilotSidebarProps> = (props) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitSidebar" : "copilotKitSidebar",
  };
  const [expandedClassName, setExpandedClassName] = useState(
    props.defaultOpen ? "sidebarExpanded" : "",
  );

  const onSetOpen = (open: boolean) => {
    props.onSetOpen?.(open);
    setExpandedClassName(open ? "sidebarExpanded" : "");
  };

  return (
    <div className={`copilotKitSidebarContentWrapper ${expandedClassName}`}>
      {props.children}
      <CopilotKitChat {...props} {...{ onSetOpen }} />
    </div>
  );
};
