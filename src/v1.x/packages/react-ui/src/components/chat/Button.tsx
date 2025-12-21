import { ButtonProps } from "./props";
import { useChatContext } from "./ChatContext";

export const Button = ({}: ButtonProps) => {
  const { open, setOpen, icons } = useChatContext();

  return (
    <div onClick={() => setOpen(!open)}>
      <button
        className={`copilotKitButton ${open ? "open" : ""}`}
        aria-label={open ? "Close Chat" : "Open Chat"}
      >
        <div className="copilotKitButtonIcon copilotKitButtonIconOpen">{icons.openIcon}</div>
        <div className="copilotKitButtonIcon copilotKitButtonIconClose">{icons.closeIcon}</div>
      </button>
    </div>
  );
};
