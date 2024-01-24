import React from "react";
import { CopilotChat, CopilotChatProps } from "./Chat";

export const CopilotPopup: React.FC<CopilotChatProps> = (props) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitPopup" : "copilotKitPopup",
  };
  return <CopilotChat {...props} />;
};
