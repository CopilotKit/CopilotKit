import { z } from "zod";
import { createAgent } from "langchain";
import {
  copilotkitMiddleware,
  CopilotKitStateSchema,
  zodState,
} from "@copilotkit/sdk-js/langgraph";
import { StateSchema } from "@langchain/langgraph";
import { createConfiguredChatOpenAI } from "./openai_config.js";
import { createOpenBoxGovernanceMiddleware } from "./openbox_governance.js";
import {
  openbox_governed_action,
  openbox_governed_approval_action,
  openbox_resume_governed_action,
} from "./openbox_scenarios.js";

const AgentStateSchema = new StateSchema({
  openboxTimingEvent: zodState(z.record(z.string(), z.unknown()).optional()),
  openboxSession: zodState(
    z
      .object({
        status: z.enum(["active", "halted"]).default("active"),
        reason: z.string().optional(),
        haltedAt: z.string().optional(),
        workflowId: z.string().optional(),
        runId: z.string().optional(),
      })
      .default(() => ({ status: "active" as const })),
  ),
  ...(CopilotKitStateSchema.fields as Record<string, any>),
});

const model = createConfiguredChatOpenAI({
  modelKwargs: { parallel_tool_calls: false },
});

const tools = [
  openbox_governed_action,
  openbox_governed_approval_action,
  openbox_resume_governed_action,
] as any[];

const systemPrompt = `You are a governed business assistant for the OpenBox × CopilotKit demo, where OpenBox is the enforcement layer for every action. Treat each user message as a fresh request: classify it and call exactly one governed tool, passing a valid JSON object with the chosen action and the user's request verbatim. Route money movement — refunds, credits, payouts, or invoice write-offs — to openbox_governed_approval_action with amountUsd, and route all other create/send/draft/review/export/disable actions to openbox_governed_action. When openbox_governed_approval_action returns status "approval_required", that is not terminal: continue and call openbox_resume_governed_action with the same workflowId, runId, activityId, approvalId, governanceEventId, and the approved decision before reporting any outcome. If a tool returns status "error", say OpenBox governance was unavailable and the action was not executed, and suggest retrying; if it returns status "halted", tell the user the session is halted and they must reset before trying another governed action. Never produce, summarize, or invent business content when a tool result is "error" or "halted" — and never refuse these governance demo requests in prose instead of calling the tool.`;

export const graph = createAgent({
  model,
  tools,
  middleware: [createOpenBoxGovernanceMiddleware(), copilotkitMiddleware],
  stateSchema: AgentStateSchema,
  systemPrompt,
});
