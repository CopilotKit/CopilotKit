import React from "react";
import { CheckCircle, Loader } from "lucide-react";

type AgentStatusProps = {
  running: boolean;
  state?: {
    status?: string;
  };
  agentStatus?: string;
};

const getStatusIcon = (status: string | undefined) => {
  if (!status) return null;
  switch (status) {
    case "executing":
    case "inProgress":
      return (
        <Loader className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-600" />
      );
    case "complete":
      return <CheckCircle className="mr-2 h-4 w-4 text-gray-600" />;
  }
};

const STATUS_MAP: Record<string, string> = {
  inProgress: "Thinking...",
  complete: "Completed",
  executing: "Thinking...",
};

const AgentStatus: React.FC<AgentStatusProps> = ({
  running,
  state,
  agentStatus,
}) => {
  if (!running || !state?.status) return null;

  return (
    <div className="absolute top-4 right-4 z-10">
      <div className="flex items-center bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-medium">
        {getStatusIcon(agentStatus)}
        {STATUS_MAP[agentStatus || "complete"]}
      </div>
    </div>
  );
};

export default AgentStatus;
