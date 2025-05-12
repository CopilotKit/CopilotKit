import React, { useCallback, useEffect } from "react";
import { WindowProps } from "./props";
import { useChatContext } from "./ChatContext";
import { useCopilotContext } from "@copilotkit/react-core";

export const Window = ({
  children,
  clickOutsideToClose,
  shortcut,
  hitEscapeToClose,
}: WindowProps) => {
  const windowRef = React.useRef<HTMLDivElement>(null);
  const context = useCopilotContext();

  const { open, setOpen } = useChatContext();

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (!clickOutsideToClose) {
        return;
      }

      const parentElement = windowRef.current?.parentElement;

      let className = "";
      if (event.target instanceof HTMLElement) {
        className = event.target.className;
      }

      if (
        open &&
        parentElement &&
        !parentElement.contains(event.target as any) &&
        // prevent closing the window when clicking on the debug menu
        !className.includes("copilotKitDebugMenu")
      ) {
        setOpen(false);
      }
    },
    [clickOutsideToClose, open, setOpen],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const isDescendantOfWrapper = windowRef.current?.contains(target);

      if (
        open &&
        event.key === "Escape" &&
        (!isInput || isDescendantOfWrapper) &&
        hitEscapeToClose
      ) {
        setOpen(false);
      } else if (
        event.key === shortcut &&
        ((isMacOS() && event.metaKey) || (!isMacOS() && event.ctrlKey)) &&
        (!isInput || isDescendantOfWrapper)
      ) {
        setOpen(!open);
      }
    },
    [hitEscapeToClose, shortcut, open, setOpen],
  );

  const adjustForMobile = useCallback(() => {
    const copilotKitWindow = windowRef.current;
    const vv = window.visualViewport;
    if (!copilotKitWindow || !vv) {
      return;
    }

    if (window.innerWidth < 640 && open) {
      copilotKitWindow.style.height = `${vv.height}px`;
      copilotKitWindow.style.left = `${vv.offsetLeft}px`;
      copilotKitWindow.style.top = `${vv.offsetTop}px`;

      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.height = `${window.innerHeight}px`;
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      // Prevent scrolling on iOS
      document.body.addEventListener("touchmove", preventScroll, {
        passive: false,
      });
    } else {
      copilotKitWindow.style.height = "";
      copilotKitWindow.style.left = "";
      copilotKitWindow.style.top = "";
      document.body.style.position = "";
      document.body.style.height = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      document.body.style.top = "";
      document.body.style.touchAction = "";

      document.body.removeEventListener("touchmove", preventScroll);
    }
  }, [open]);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", adjustForMobile);
      adjustForMobile();
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", adjustForMobile);
      }
    };
  }, [adjustForMobile, handleClickOutside, handleKeyDown]);

  return (
    <div className={`copilotKitWindow ${open ? " open" : ""}`} ref={windowRef}>
      {children}
    </div>
  );
};

const preventScroll = (event: TouchEvent): void => {
  let targetElement = event.target as Element;

  // Function to check if the target has the parent with a given class
  const hasParentWithClass = (element: Element, className: string): boolean => {
    while (element && element !== document.body) {
      if (element.classList.contains(className)) {
        return true;
      }
      element = element.parentElement!;
    }
    return false;
  };

  // Check if the target of the touch event is inside an element with the 'copilotKitMessages' class
  if (!hasParentWithClass(targetElement, "copilotKitMessages")) {
    event.preventDefault();
  }
};

function isMacOS() {
  return /Mac|iMac|Macintosh/i.test(navigator.userAgent);
}
