import React, { useMemo, useState, useRef, useEffect } from "react";
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
      className="copilotKitDebugMenuTriggerButton relative"
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
          className="absolute z-50 mt-2"
          style={{
            top: "100%",
            right: "-120px",
            width: "380px",
          }}
        >
          <div className="copilotKitHelpModal relative w-full flex-col rounded-lg p-4 shadow-xl">
            <button
              className="copilotKitHelpModalCloseButton absolute text-gray-400 hover:text-gray-600 focus:outline-none"
              style={{ top: "10px", right: "10px" }}
              onClick={() => setShowHelpModal(false)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <div className="mb-6 flex w-full justify-center">
              <h2 className="text-2xl font-bold">Help Options</h2>
            </div>
            <div className="mb-4 space-y-4">
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
