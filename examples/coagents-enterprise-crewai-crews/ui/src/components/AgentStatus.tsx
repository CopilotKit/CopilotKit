import React from "react";
import { AgentState, RunStatus } from "@/types/agent";
import { Loader, CheckCircle, AlertCircle, MessageCircle } from "lucide-react";

type AgentStatusProps = {
  running: boolean;
  state?: {
    status?: AgentState["status"];
  };
  agentStatus?: RunStatus;
};

const getStatusIcon = (status: AgentState["status"] | undefined) => {
  if (!status) return null;
  switch (status) {
    case "thinking":
      return (
        <Loader className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-600" />
      );
    case "completed":
      return <CheckCircle className="mr-2 h-4 w-4 text-gray-600" />;
    case "error":
      return <AlertCircle className="mr-2 h-4 w-4 text-gray-600" />;
    case "human_input_requested":
      return <MessageCircle className="mr-2 h-4 w-4 text-gray-600" />;
  }
};

const STATUS_MAP: Record<AgentState["status"], string> = {
  thinking: "Thinking...",
  completed: "Completed",
  error: "Error",
  human_input_requested: "Awaiting Your Feedback",
};

const AgentStatus: React.FC<AgentStatusProps> = ({
  running,
  state,
  agentStatus,
}) => {
  if (!running || !state?.status) return null;
  const status = agentStatus === "inProgress" ? "thinking" : state?.status;
  return (
    <div className="absolute top-4 right-4 z-10">
      <div className="flex items-center bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-medium">
        {getStatusIcon(status)}
        {STATUS_MAP[status]}
      </div>
    </div>
  );
};

export default AgentStatus;
