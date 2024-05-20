import { ButtonProps } from "./props";
import { useChatContext } from "./ChatContext";

export const Button = ({ open, setOpen }: ButtonProps) => {
  const context = useChatContext();

  return (
    <div onClick={() => setOpen(!open)}>
      <button
        className={`copilotKitButton ${open ? "open" : ""}`}
        aria-label={open ? "Close Chat" : "Open Chat"}
      >
        <div className="copilotKitButtonIcon copilotKitButtonIconOpen">
          {context.icons.openIcon}
        </div>
        <div className="copilotKitButtonIcon copilotKitButtonIconClose">
          {context.icons.closeIcon}
        </div>
      </button>
    </div>
  );
};
