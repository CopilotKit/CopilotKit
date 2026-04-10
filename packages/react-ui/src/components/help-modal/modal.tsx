import React, { useState, useRef, useEffect } from "react";
import { CloseIcon } from "./icons";

export function CopilotKitHelpModal() {
  const [showHelpModal, setShowHelpModal] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowHelpModal(false);
      }
    };

    if (showHelpModal) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showHelpModal]);

  const HelpButton = () => (
    <button
      ref={buttonRef}
      onClick={() => setShowHelpModal(!showHelpModal)}
      className="copilotKitDebugMenuTriggerButton cpk:relative"
      aria-label="Open Help"
    >
      Help
    </button>
  );

  return (
    <div className="relative">
      <HelpButton />
      {showHelpModal && (
        <div
          ref={popoverRef}
          className="cpk:absolute cpk:mt-2 cpk:z-50"
          style={{
            top: "100%",
            right: "-120px",
            width: "380px",
          }}
        >
          <div className="copilotKitHelpModal cpk:rounded-lg cpk:shadow-xl cpk:w-full cpk:p-4 cpk:flex-col cpk:relative">
            <button
              className="copilotKitHelpModalCloseButton cpk:absolute cpk:text-gray-400 cpk:hover:text-gray-600 cpk:focus:outline-none"
              style={{ top: "10px", right: "10px" }}
              onClick={() => setShowHelpModal(false)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <div className="cpk:w-full cpk:flex cpk:mb-6 cpk:justify-center">
              <h2 className="cpk:text-2xl cpk:font-bold">Help Options</h2>
            </div>
            <div className="cpk:space-y-4 cpk:mb-4">
              <div className="copilotKitHelpItemButton">
                <a
                  href="https://docs.copilotkit.ai/coagents/troubleshooting/common-issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit the Troubleshooting and FAQ section in the docs
                </a>
              </div>
              <div className="copilotKitHelpItemButton">
                <a
                  href="https://go.copilotkit.ai/dev-console-support-discord"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Go to Discord Support Channel (Community Support)
                </a>
              </div>
              <div className="copilotKitHelpItemButton">
                <a
                  href="https://go.copilotkit.ai/dev-console-support-slack"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apply for Priority Direct Slack Support
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
