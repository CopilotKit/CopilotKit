import { HeaderProps } from "./props";
import { useChatContext } from "./ChatContext";
import { CopilotDevConsole } from "../dev-console";

export const Header = ({ }: HeaderProps) => {
  const { setOpen, icons, labels } = useChatContext();

  return (
    <div className="copilotKitHeader">
      <div>
        <div>
          {labels.title}
        </div>
        {!!labels.belowTitleRender && labels.belowTitleRender}
      </div>
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
    </div >
  );
};
