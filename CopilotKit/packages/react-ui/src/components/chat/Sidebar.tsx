import React from "react";
import { CopilotKitChat, CopilotKitChatProps } from "./Chat";

export const CopilotKitSidebar: React.FC<CopilotKitChatProps> = (props) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitSidebar" : "copilotKitSidebar",
  };
  return <CopilotKitChat {...props} />;
};
