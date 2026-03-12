import ReactMarkdown from "react-markdown";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type Feedback = {
  timestamp: string;
  id: string;
  task_id: string;
  task_output: string;
  meta: Record<string, unknown>;
};

export const SubmitCrewFeedback = ({
  feedback,
  respond,
}: {
  feedback: Feedback;
  respond?: (input: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="text-right">
      {/* Feedback content - conditionally expanded */}
      {isExpanded && (
        <div className="mb-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded text-left">
          <ReactMarkdown>{feedback.task_output}</ReactMarkdown>
        </div>
      )}

      <div className="inline-flex flex-col items-end">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mr-1 focus:outline-none"
          >
            {isExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          <span>Feedback submission</span>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => {
              setIsExpanded(false);
              respond?.("Approve");
            }}
            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
          >
            Approve
          </button>
          <button
            onClick={() => {
              setIsExpanded(false);
              respond?.("Do not approve");
            }}
            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
};
