import { UserMessageProps } from "../props";

export const UserMessage = (props: UserMessageProps) => {
  return (
    <div className="copilotKitMessage copilotKitUserMessage">
      {props.subComponent || props.message}
    </div>
  );
};
