import { CrewsResponseStatus, CrewsStateItem } from "@copilotkit/react-core";
import { useState } from "react";

export interface CrewsFeedback extends CrewsStateItem {
  /**
   * Output of the task execution
   */
  task_output?: string;
}

/**
 * Renders a simple UI for agent-requested user feedback (Approve / Reject).
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

  if (status === "complete") {
    return (
      <div style={{ marginTop: 8, textAlign: "right" }}>
        {userResponse || "Feedback submitted."}
      </div>
    );
  }

  if (status === "inProgress" || status === "executing") {
    return (
      <div style={{ marginTop: 8 }}>
        {isExpanded && (
          <div
            style={{
              border: "1px solid #ddd",
              padding: "8px",
              marginBottom: "8px",
            }}
          >
            {feedback.task_output}
          </div>
        )}
        <div style={{ textAlign: "right" }}>
          <button
            style={{ marginRight: 8 }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "Hide" : "Show"} Feedback
          </button>
          <button
            style={{
              marginRight: 8,
              backgroundColor: "#222222",
              border: "none",
              padding: "8px 16px",
              color: "white",
              cursor: "pointer",
              borderRadius: "4px",
            }}
            onClick={() => {
              setUserResponse("Approved");
              /**
               * This string is arbitrary. It can be any serializable input that will be forwarded to your Crew as feedback.
               */
              respond?.("Approve");
            }}
          >
            Approve
          </button>
          <button
            style={{
              backgroundColor: "#222222",
              border: "none",
              padding: "8px 16px",
              color: "white",
              cursor: "pointer",
              borderRadius: "4px",
            }}
            onClick={() => {
              setUserResponse("Rejected");
              /**
               * This string is arbitrary. It can be any serializable input that will be forwarded to your Crew as feedback.
               */
              respond?.("Reject");
            }}
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default CrewHumanFeedbackRenderer;
