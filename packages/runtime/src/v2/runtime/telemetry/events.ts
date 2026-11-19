import type { ModelHostClass } from "@copilotkit/shared";

export type AnalyticsEvents = {
  "oss.runtime.instance_created": RuntimeInstanceCreatedInfo;
  "oss.runtime.copilot_request_created": {
    "cloud.guardrails.enabled": boolean;
    requestType: string;
    "cloud.api_key_provided": boolean;
    "cloud.public_api_key"?: string;
    "cloud.base_url"?: string;
  };
  "oss.runtime.agent_execution_stream_started": { hashedLgcKey?: string };
  "oss.runtime.agent_execution_stream_ended": AgentExecutionResponseInfo;
  "oss.runtime.agent_execution_stream_errored": {
    hashedLgcKey?: string;
    error?: string;
  };
  /**
   * A managed Channel lost its gateway link. Carries only the cause we already
   * compute for the log line — never the Channel name, which is a
   * customer-chosen identifier, and never message content.
   */
  "oss.runtime.channel_session_dropped": ChannelSessionDroppedInfo;
  /** A managed Channel's gateway link came back, and how long it was gone. */
  /**
   * The framework an agent's adapter declares through AG-UI `identity.type`,
   * sent once per agent name per runtime. Carries only closed-vocabulary
   * values: never the agent's name, description or URL.
   */
  "oss.runtime.agent_identified": AgentIdentifiedInfo;
  "oss.runtime.channel_session_recovered": { downForMs: number };
};

export interface ChannelSessionDroppedInfo {
  /** Diagnosis of the drop, e.g. `the gateway host answered HTTP 502`. */
  reason?: string;
  /** Transport/OS code when the transport named one, e.g. `ECONNRESET`. */
  code?: string;
}

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

export interface AgentExecutionResponseInfo {
  /**
   * Which vendor the runtime actually sent the completion to, as a closed
   * vocabulary — see `classifyModelHost`. Distinct from `provider` below,
   * which the upstream reports as a model name and which cannot tell Azure,
   * OpenRouter or a local server apart from OpenAI.
   *
   * `unknown` when the developer handed us an already-built model, because
   * the endpoint is unrecoverable from one.
   */
  llmHostClass?: ModelHostClass;
  provider?: string;
  model?: string;
  langGraphHost?: string;
  langGraphVersion?: string;
  hashedLgcKey?: string;
}

export interface AgentIdentifiedInfo {
  /** A listed framework name, `other`, or `undeclared`. */
  framework: string;
  /** The external adapter package's semver version, when it declares one. */
  adapter_version?: string;
  /** Whether the agent is a generic AG-UI `HttpAgent`. */
  via_http_agent: boolean;
  /** How the framework was learned. */
  source: "declared";
}
