import React, { useState } from "react";
import { CopilotChat, CopilotChatProps } from "./Chat";

interface CopilotSidebarProps extends CopilotChatProps {
  children?: React.ReactNode;
}

export const CopilotSidebar = (props: CopilotSidebarProps) => {
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
      <CopilotChat {...props} {...{ onSetOpen }}>
        {props.children}
      </CopilotChat>
    </div>
  );
};
