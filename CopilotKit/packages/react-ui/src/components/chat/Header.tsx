import { CopilotDevConsole } from "../dev-console";
import { useChatContext } from "./ChatContext";
import { HeaderProps } from "./props";

export const Header = (_props: HeaderProps) => {
  const { setOpen, icons, labels } = useChatContext();

  return (
    <div className="copilotKitHeader">
      <div>{labels.title}</div>
      <div className="copilotKitHeaderControls">
        <CopilotDevConsole />
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="copilotKitHeaderCloseButton"
        >
          {icons.headerCloseIcon}
        </button>
      </div>
    </div>
  );
};
