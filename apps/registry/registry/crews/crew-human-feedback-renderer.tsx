import { CrewsResponseStatus, CrewsStateItem } from "@copilotkit/react-core";
import { Markdown } from "@copilotkit/react-ui";
import { useState } from "react";

/**
 * Interface defining the feedback structure requested by the crew agents
 */
export interface CrewsFeedback extends CrewsStateItem {
  /**
   * Output of the task execution that requires user feedback
   */
  task_output?: string;
}

/**
 * Component that renders a UI for agent-requested user feedback
 * 
 * This component presents the task output from the crew and provides
 * buttons for the user to approve or reject the proposed solution.
 * 
 * @param feedback - The feedback object containing task output
 * @param respond - Callback function to send user response back to the crew
 * @param status - Current status of the feedback request
 */
function CrewHumanFeedbackRenderer({
  feedback,
  respond,
  status,
}: {
  feedback: CrewsFeedback;
  respond?: (input: string) => void;
  status: CrewsResponseStatus;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [userResponse, setUserResponse] = useState<string | null>(null);

  // If feedback request is complete, show the user's response
  if (status === "complete") {
    return (
      <div className="mt-3 text-right text-sm text-zinc-600 dark:text-zinc-400 italic">
        {userResponse || "Feedback submitted."}
      </div>
    );
  }

  // If feedback request is in progress, show the feedback UI
  if (status === "inProgress" || status === "executing") {
    return (
      <div className="mt-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm">
        <div className="flex justify-between items-center mb-2 border-b border-zinc-100 dark:border-zinc-700 pb-2">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Feedback Required</h3>
          <button
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "Hide" : "Show"} Details
          </button>
        </div>

        {isExpanded && (
          <div className="border border-zinc-100 dark:border-zinc-700 rounded-md p-3 mb-3 text-sm bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 max-h-[200px] overflow-y-auto">
            <Markdown content={feedback.task_output || ""} />
          </div>
        )}
        
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 cursor-pointer bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:active:bg-zinc-500 text-zinc-800 dark:text-zinc-200 rounded-md text-sm font-medium transition-colors"
            onClick={() => {
              setUserResponse("Rejected");
              // Send 'Reject' feedback to the crew
              respond?.("Reject");
            }}
          >
            Reject
          </button>
          <button
            className="px-4 py-2 cursor-pointer bg-black hover:bg-zinc-800 active:bg-zinc-900 text-white rounded-md text-sm font-medium transition-colors"
            onClick={() => {
              setUserResponse("Approved");
              // Send 'Approve' feedback to the crew
              respond?.("Approve");
            }}
          >
            Approve
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default CrewHumanFeedbackRenderer;
