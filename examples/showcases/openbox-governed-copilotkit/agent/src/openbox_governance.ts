import { AIMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { AgentMiddleware } from "langchain";
import type { OpenBoxCoreClient } from "@openbox-ai/openbox-sdk";
import {
  createOpenBoxCopilotKitAdapter,
  OpenBoxCopilotKitError,
} from "@openbox-ai/openbox-sdk/copilotkit";

const WORKFLOW_TYPE = "CopilotKitLangGraphAgent";
const TASK_QUEUE = "copilotkit-langgraph";
const CORE_TIMEOUT_MS = 180_000;
const SELF_GOVERNED_OPENBOX_TOOLS = new Set([
  "openbox_governed_action",
  "openbox_governed_approval_action",
  "openbox_resume_governed_action",
]);

export class OpenBoxGovernanceError extends OpenBoxCopilotKitError {}

export const openBoxCopilotKitAdapter = createOpenBoxCopilotKitAdapter({
  agentWorkflowType: WORKFLOW_TYPE,
  taskQueue: TASK_QUEUE,
  selfGovernedToolNames: SELF_GOVERNED_OPENBOX_TOOLS,
  clientName: "openbox-governed-copilotkit",
  coreTimeoutMs: CORE_TIMEOUT_MS,
});

export function createOpenBoxGovernanceMiddleware(): AgentMiddleware {
  return openBoxCopilotKitAdapter.createLangChainMiddleware({
    createMiddleware,
    AIMessage,
  }) as AgentMiddleware;
}

export function isOpenBoxEnabled(): boolean {
  return openBoxCopilotKitAdapter.isEnabled();
}

export function getCoreClient(): OpenBoxCoreClient {
  return openBoxCopilotKitAdapter.getCoreClient();
}
