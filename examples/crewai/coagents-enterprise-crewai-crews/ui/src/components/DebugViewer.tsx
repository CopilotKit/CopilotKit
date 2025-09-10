"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import FormattedContent from "@/components/FormattedContent";
import { AgentState } from "@/types";

interface DebugViewerProps {
  state: AgentState;
}

export const DebugViewer: React.FC<DebugViewerProps> = ({ state }) => {
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  return (
    <>
      <div className="absolute bottom-4 right-4">
        <button
          onClick={() => setIsDebugOpen(true)}
          className="cursor-pointer w-10 h-10 rounded-full flex items-center justify-center bg-gray-700 hover:bg-gray-800 text-white"
          aria-label="View agent state"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Debug Modal */}
      <Modal isOpen={isDebugOpen} onClose={() => setIsDebugOpen(false)}>
        <FormattedContent
          content={JSON.stringify(state, null, 2)}
          showJsonLabel={false}
        />
      </Modal>
    </>
  );
};
