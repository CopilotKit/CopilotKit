export type AnalyticsEvents = {
  "oss.runtime.instance_created": {};
  "oss.runtime.copilot_request_created": {
    "cloud.guardrails.enabled": boolean;
    requestType: string;
  };
  "oss.runtime.server_action_executed": {};
  "oss.runtime.remote_action_executed": {};
};
