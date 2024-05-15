import { useEffect, useRef, useState } from "react";
import { ButtonProps } from "./props";
import { useChatContext } from "./ChatContext";

export const Button = ({ open, setOpen, pushToTalk, setPushToTalk }: ButtonProps) => {
  const context = useChatContext();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isLongPress, setIsLongPress] = useState(false);

  const handleMouseDown = () => {
    timerRef.current = setTimeout(() => {
      setPushToTalk(true);
      setIsLongPress(true);
    }, 500); // 500ms for long press
  };

  const handleMouseUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      setPushToTalk(false);
    }
  };

  const handleClick = () => {
    if (!isLongPress) {
      setOpen(!open);
    } else {
      setIsLongPress(false);
    }
  };

  // we want to handle the mouse up event event outside of the button component
  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div onClick={handleClick} onMouseDown={handleMouseDown}>
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
