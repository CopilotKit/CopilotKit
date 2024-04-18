import { CopilotChat, CopilotChatProps } from "./Chat";

interface CopilotPopupProps extends CopilotChatProps {
  children?: React.ReactNode;
}

export const CopilotPopup = (props: CopilotChatProps) => {
  props = {
    ...props,
    className: props.className ? props.className + " copilotKitPopup" : "copilotKitPopup",
  };
  return <CopilotChat {...props}>{props.children}</CopilotChat>;
};
