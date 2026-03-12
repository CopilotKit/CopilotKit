/**
 * MessageFromA2A Component
 *
 * Visualizes agent → orchestrator responses as a blue box showing
 * sender/receiver badges and confirmation. Actual structured data
 * is rendered separately in the main content area.
 */

import React from "react";
import { MessageActionRenderProps } from "../types";
import { getAgentStyle } from "./agent-styles";

export const MessageFromA2A: React.FC<MessageActionRenderProps> = ({ status, args }) => {
  switch (status) {
    case "complete":
      break;
    default:
      return null;
  }

  const agentStyle = getAgentStyle(args.agentName);

  return (
    <div className="my-2">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-[200px] flex-shrink-0">
            <div className="flex flex-col items-center">
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold border-2 ${agentStyle.bgColor} ${agentStyle.textColor} ${agentStyle.borderColor} flex items-center gap-1`}
              >
                <span>{agentStyle.icon}</span>
                <span>{args.agentName}</span>
              </span>
              {agentStyle.framework && (
                <span className="text-[9px] text-gray-500 mt-0.5">{agentStyle.framework}</span>
              )}
            </div>

            <span className="text-gray-400 text-sm">→</span>

            <div className="flex flex-col items-center">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-700 text-white">
                Orchestrator
              </span>
              <span className="text-[9px] text-gray-500 mt-0.5">ADK</span>
            </div>
          </div>

          <span className="text-xs text-gray-600">✓ Response received</span>
        </div>
      </div>
    </div>
  );
};
