import { HeaderProps } from "./props";
import { useChatContext } from "./ChatContext";

export const Header = ({}: HeaderProps) => {
  const { setOpen, icons, labels } = useChatContext();

  return (
    <div className="copilotKitHeader">
      <div>{labels.title}</div>
      <button onClick={() => setOpen(false)} aria-label="Close">
        {icons.headerCloseIcon}
      </button>
    </div>
  );
};
