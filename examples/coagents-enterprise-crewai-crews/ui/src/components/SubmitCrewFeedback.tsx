import { Feedback, RunStatus } from "@/types/agent";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

const createFeedbackCache = <T extends { id: string }>() => {
  const feedbackCache = new Map<string, T>();

  return {
    getFeedback: (id: string) => feedbackCache.get(id),
    setFeedback: (id: string, feedback: T) => feedbackCache.set(id, feedback),
  };
};

const useFeedbackCache = createFeedbackCache<Feedback>();

export const SubmitCrewFeedback = ({
  feedback,
  respond,
  status,
}: {
  feedback: Feedback;
  respond?: (input: string) => void;
  status: RunStatus;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const getFeedback = () => {
    if (status === "complete") {
      const userFeedback = useFeedbackCache.getFeedback(feedback.id);
      return (
        <div className="flex justify-end">
          <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded-md inline-flex items-center">
            <p className="text-gray-700 dark:text-gray-300 text-xs">
              <span className="font-medium text-black dark:text-white">
                {userFeedback?.__client_only_feedback__
                  ? `${userFeedback.__client_only_feedback__}`
                  : "User Feedback submitted"}
              </span>
            </p>
          </div>
        </div>
      );
    }

    if (status === "inProgress" || status === "executing") {
      return (
        <>
          <button
            onClick={() => {
              setIsExpanded(false);
              respond?.("Approve");
              useFeedbackCache.setFeedback(feedback.id, {
                ...feedback,
                __client_only_feedback__: "Approved",
              });
            }}
            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
          >
            Approve
          </button>
          <button
            onClick={() => {
              setIsExpanded(false);
              useFeedbackCache.setFeedback(feedback.id, {
                ...feedback,
                __client_only_feedback__: "Rejected",
              });
              respond?.("Do not approve");
            }}
            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
          >
            Reject
          </button>
        </>
      );
    }

    return <></>;
  };

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

        <div className="flex space-x-2">{getFeedback()}</div>
      </div>
    </div>
  );
};
