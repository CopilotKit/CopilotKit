import { CopilotChat, CopilotChatProps } from "./Chat";

export const CopilotPopup = (props: CopilotChatProps) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitPopup" : "copilotKitPopup",
  };
  return <CopilotChat {...props} />;
};
