import { RemoteEndpointType } from "../utils/detect-endpoint-type.utils.js";

export type AnalyticsEvents = {
  "cli.login.initiated": {};
  "cli.login.success": {
    organizationId: string;
    userId: string;
    email: string;
  };
  "cli.logout": {
    organizationId: string;
    userId: string;
    email: string;
  };
  "cli.dev.initiatied": {
    port: string;
    projectId: string;
    endpointType:
      | RemoteEndpointType.LangGraphPlatform
      | RemoteEndpointType.CopilotKit
      | RemoteEndpointType.CrewAI
      | RemoteEndpointType.MCP;
  };
  "cli.dev.tunnel.created": {
    tunnelId: string;
    port: string;
    projectId: string;
    endpointType:
      | RemoteEndpointType.LangGraphPlatform
      | RemoteEndpointType.CopilotKit
      | RemoteEndpointType.CrewAI
      | RemoteEndpointType.MCP;
  };
  "cli.dev.tunnel.closed": {
    tunnelId: string;
  };

  // NEW: Init command analytics events
  "cli.init.started": {
    nextjs_detected: boolean;
    flags_used?: string[]; // Which CLI flags were provided
  };

  // ABC Test events
  "cli.init.abc_branch_selected": {
    branch: "A" | "B" | "C";
  };
  "cli.init.branch_a_cloud_setup_completed": {
    branch: "A";
    projectId: string;
    api_key_retrieved: boolean;
  };
  "cli.init.branch_a_cloud_setup_failed": {
    branch: "A";
    error: string;
  };
  "cli.init.branch_b_api_key_setup_completed": {
    branch: "B";
    projectId: string;
    api_key_retrieved: boolean;
  };
  "cli.init.branch_b_api_key_setup_failed": {
    branch: "B";
    error: string;
  };

  // Updated mode selection with new properties
  "cli.init.mode_selected": {
    mode:
      | "LangGraph"
      | "CrewAI"
      | "Standard"
      | "MCP"
      | "Mastra"
      | "LlamaIndex"
      | "Agno"
      | "AG2";
    cloud_setup_completed?: boolean;
    deployment_choice?: "Copilot Cloud" | "Self-hosted";
  };

  // Updated cloud deployment selection with new properties
  "cli.init.cloud_deployment_selected": {
    deployment_choice?: "Copilot Cloud" | "Self-hosted";
    use_copilot_cloud?: "Yes" | "No";
    needs_cloud_deployment: boolean;
    mode: string;
  };

  // Updated completion event with new properties
  "cli.init.completed": {
    mode: string;
    cloud_setup_completed: boolean;
    cloud_deployment: boolean;
    deployment_choice?: "Copilot Cloud" | "Self-hosted";
    agent_scaffolded: boolean;
    api_key_in_env: boolean;
    duration_ms: number;
  };

  // Updated failure event
  "cli.init.failed": {
    error: string;
    step: string;
    mode?: string;
    cloud_setup_completed?: boolean;
  };

  // Legacy event (keeping for backward compatibility)
  "cli.init.cloud_used": {
    userId: string;
  };

  // Create command analytics events
  "cli.create.started": {
    framework_selected?: string;
    project_name?: string;
    flags_used?: string[];
  };

  "cli.create.cloud_setup_completed": {
    framework: string;
    project_id: string;
    api_key_retrieved: boolean;
  };

  "cli.create.cloud_setup_failed": {
    framework: string;
    error: string;
  };

  "cli.create.project_created": {
    framework: string;
    project_name: string;
    has_api_key: boolean;
    duration_ms: number;
  };

  "cli.create.completed": {
    framework: string;
    project_name: string;
    cloud_setup_completed: boolean;
    api_key_configured: boolean;
    duration_ms: number;
  };

  "cli.create.failed": {
    framework?: string;
    project_name?: string;
    error: string;
    step: string;
    duration_ms: number;
  };

  // Tip system events
  "cli.tip.shown": {
    tip_id: string;
    category?: string;
    command: string;
  };
};
