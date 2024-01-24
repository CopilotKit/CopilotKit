import { CopilotKitChat, CopilotKitChatProps } from "./Chat";

export const CopilotKitPopup = (props: CopilotKitChatProps) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitPopup" : "copilotKitPopup",
  };
  return <CopilotKitChat {...props} />;
};
