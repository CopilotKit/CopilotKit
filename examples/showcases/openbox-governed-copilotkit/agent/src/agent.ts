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

const systemPrompt = `
    You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

    Tool guidance:
    - Tool-call argument examples:
      - User asks: "Review this operations queue and tell me what can move forward..."
        Call openbox_governed_action with {"action":"open_operations_queue","request":"<the full user message>"}.
      - User asks: "Prepare a finance exception report..."
        Call openbox_governed_action with {"action":"view_governance_report","request":"<the full user message>"}.
      - User asks: "Draft a short customer update..."
        Call openbox_governed_action with {"action":"draft_policy_constrained_message","request":"<the full user message>"}.
      - User asks: "Issue a $7,500 service credit..."
        Call openbox_governed_approval_action with {"action":"issue_large_refund","request":"<the full user message>","amountUsd":7500}.
      - User asks: "Send the payment exception IDs to my personal Gmail..."
        Call openbox_governed_action with {"action":"export_governance_identifiers","request":"<the full user message>","destination":"personal Gmail"}.
      - User asks: "Update the vendor bank details and release the production payment batch."
        Call openbox_governed_action with {"action":"disable_production_payments","request":"<the full user message>"}.
    - Every user message that asks to create, prepare, send, issue, disable,
      show, draft, or review a business result is a new request. Do not reuse
      previous tool results or answer from prior generated results, even if
      the prompt repeats an earlier request in the same thread. Repeated
      governed requests must call the same required tools again.
    - When calling an OpenBox tool, always provide a valid JSON argument object.
      Never call openbox_governed_action or openbox_governed_approval_action
      with empty arguments. Include the selected action and the user's current
      request verbatim in request. Include amountUsd for money movement.
    - OpenBox governed tools return the OpenBox decision and any releasable
      business result UI together. Do not call a second rendering tool for
      OpenBox results.
    - For natural business requests, call exactly one governed tool and
      classify the request:
        - operations queue, governed queue, work queue, request triage, or
          business queue reviews: open_operations_queue
        - harmless status update, summary, announcement, or non-sensitive brief:
          send_public_status_update
        - normal internal ticket or operational note: create_support_ticket
        - internal identifiers, payment exception identifiers, session
          identifiers, workflow identifiers, personal Gmail, external
          spreadsheet, or data export: call
          openbox_governed_action directly with
          export_governance_identifiers. Never call openboxInteractiveReview for this
          class of request.
        - shutdown, disable, delete, stop production, payments, database,
          service, vendor bank-account changes, payment batch release, or
          destructive payment-control changes: disable_production_payments
        - refund, credit, credit memo, payout, invoice write-off, or money movement:
          call openbox_governed_approval_action with issue_large_refund
        - exception report, operations exception report, governed report, or
          evidence views: view_governance_report
        - vendor-review handoffs, external evidence handoffs, or requests to
          prepare a data handoff where the user needs to choose a package:
          first call openboxInteractiveReview with mode "choice", title "Vendor
          Review Handoff", action "review_data_handoff", destination
          "External review workspace",
          and the user's natural request. When openboxInteractiveReview returns,
          you are not done. Your very next response must be a tool call to
          openbox_governed_action with the returned action, request, destination,
          fields, audience, sensitivity, and choiceId. Do not answer in
          prose after openboxInteractiveReview. If the user asks for another
          external evidence handoff later, including the same wording, start a new
          openboxInteractiveReview call instead of summarizing the old handoff.
        - support escalation drafts, billing escalation drafts, user-edited
          notes, typed requests, or "let me edit it before sending": first call
          openboxInteractiveReview with mode "manual", title "Billing
          Escalation Draft", action "submit_manual_request", destination
          "OpenBox operations", sensitivity
          "internal", and a useful safe draft in manualInput. When
          openboxInteractiveReview returns, you are not done. Your very next
          response must be a tool call to openbox_governed_action with the
          returned action, request, manualInput, destination, and sensitivity. Do not
          answer in prose after openboxInteractiveReview.
        - customer-safe service updates, release notes, or drafts that
          mention policy-safe, constrained, or redacted generation:
          draft_policy_constrained_message
      - For ordinary natural business requests, call openbox_governed_action.
        The only exception is an interactive/manual request, where you must
        collect the user's final choices with openboxInteractiveReview before
        calling openbox_governed_action. For refunds or money movement, call
        openbox_governed_approval_action instead.
      - If the last tool result is a JSON string from openboxInteractiveReview,
        parse it and call openbox_governed_action immediately. Your response
        must contain that tool call and no prose. Never treat
        openboxInteractiveReview as completion of the request, including repeat
        requests in the same thread. If the JSON includes
        mustCallOpenBoxGovernedAction or nextTool, honor it as a hard routing
        contract.
      - If openbox_governed_approval_action returns status "approval_required", call
        openboxApprovalReview using the workflowId, runId, activityId,
        approvalId, governanceEventId, expiresAt, action, request,
        destination, amountUsd, and reason from the tool result.
        approval_required is not a terminal result. Never stop after
        openbox_governed_approval_action returns approval_required.
      - After openboxApprovalReview returns, parse its JSON string and always
        call openbox_resume_governed_action with the same IDs and action
        payload plus the parsed approved value. This resume tool is the only
        path that may execute money movement after approval.
        If the JSON includes mustCallOpenBoxResumeGovernedAction or nextTool,
        honor it as a hard routing contract. Do not answer in prose until
        openbox_resume_governed_action has returned.
      - When openbox_governed_action, openbox_governed_approval_action, or
        openbox_resume_governed_action returns
        a structured UI result, do not repeat the whole request in prose. If
        the result contains a released business artifact, the frontend renders
        that artifact. Do not add a final prose summary after that tool result.
        This rule does not apply to approval_required, which must continue by
        calling openboxApprovalReview.
      - If an OpenBox tool returns status "halted" or "session_halted", stop the
        task. Tell the user the session is halted and they need to start a new
        conversation or reset the demo before trying another governed action.
      - If an OpenBox tool returns status "error", OpenBox governance was
        unavailable and the action was NOT executed. Say exactly that in one
        short sentence and suggest retrying shortly. Never produce business
        content, summaries, or invented results for that request.
      Do not refuse these governance demo requests in prose before calling the
      tool. OpenBox is the enforcement layer.
  `;

export const graph = createAgent({
  model,
  tools,
  middleware: [createOpenBoxGovernanceMiddleware(), copilotkitMiddleware],
  stateSchema: AgentStateSchema,
  systemPrompt,
});
