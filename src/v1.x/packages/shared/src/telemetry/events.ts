export type AnalyticsEvents = {
  "oss.runtime.instance_created": RuntimeInstanceCreatedInfo;
  "oss.runtime.copilot_request_created": {
    "cloud.guardrails.enabled": boolean;
    requestType: string;
    "cloud.api_key_provided": boolean;
    "cloud.public_api_key"?: string;
    "cloud.base_url"?: string;
  };
  "oss.runtime.server_action_executed": {};
  "oss.runtime.remote_action_executed": RemoteActionExecutionInfo;
  "oss.runtime.agent_execution_stream_started": { hashedLgcKey?: string };
  "oss.runtime.agent_execution_stream_ended": AgentExecutionResponseInfo;
  "oss.runtime.agent_execution_stream_errored": { hashedLgcKey?: string; error?: string };
};

export interface RuntimeInstanceCreatedInfo {
  actionsAmount: number;
  endpointTypes: string[];
  hashedLgcKey?: string;
  endpointsAmount: number;
  agentsAmount?: number | null;
  "cloud.api_key_provided": boolean;
  "cloud.public_api_key"?: string;
  "cloud.base_url"?: string;
}

export interface RemoteActionExecutionInfo {
  agentExecution: boolean;
  type: "self-hosted" | "langgraph-platform";
  agentsAmount?: number | null;
  hashedLgcKey?: string;
}

export interface AgentExecutionResponseInfo {
  provider?: string;
  model?: string;
  langGraphHost?: string;
  langGraphVersion?: string;
  hashedLgcKey?: string;
}
