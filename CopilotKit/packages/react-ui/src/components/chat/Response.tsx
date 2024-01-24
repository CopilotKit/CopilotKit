import { useChatContext } from "./ChatContext";
import { ResponseButtonProps } from "./props";

export const ResponseButton = ({ onClick, inProgress }: ResponseButtonProps) => {
  const context = useChatContext();
  return (
    <button onClick={onClick} className="copilotKitResponseButton">
      <span>{inProgress ? context.icons.stopIcon : context.icons.regenerateIcon}</span>
      {inProgress ? context.labels.stopGenerating : context.labels.regenerateResponse}
    </button>
  );
};
