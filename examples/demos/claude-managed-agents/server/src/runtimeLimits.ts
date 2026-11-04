import type { ManagedAgentsAgentConfig } from "@ag-ui/claude-managed-agents";
import express from "express";

import { financialAssistantTools } from "./financialAssistantTools.ts";
import type { AgentIds } from "./setup.ts";

const COPILOT_REQUEST_BODY_LIMIT_BYTES = 256 * 1024;
const MANAGED_AGENT_TURN_TIMEOUT_MS = 90_000;

export function createFinancialAssistantAgentConfig(
  ids: AgentIds,
): ManagedAgentsAgentConfig {
  return {
    managedAgentId: ids.agentId,
    environmentId: ids.environmentId,
    backendTools: financialAssistantTools,
    turnTimeoutMs: MANAGED_AGENT_TURN_TIMEOUT_MS,
  };
}

export function createCopilotRequestBodyParser() {
  return express.raw({
    type: () => true,
    limit: COPILOT_REQUEST_BODY_LIMIT_BYTES,
  });
}
