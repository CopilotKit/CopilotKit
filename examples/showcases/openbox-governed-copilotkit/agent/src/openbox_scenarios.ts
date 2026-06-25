import { z } from "zod";
import { tool } from "@langchain/core/tools";
import {
  governAction,
  resumeGovernedAction,
} from "./openbox_action_governance.js";

const GOVERNED_ACTIONS = [
  "open_operations_queue",
  "send_public_status_update",
  "create_support_ticket",
  "export_governance_identifiers",
  "disable_production_payments",
  "issue_large_refund",
  "review_data_handoff",
  "submit_manual_request",
  "view_governance_report",
  "draft_policy_constrained_message",
] as const;
const DIRECT_GOVERNED_ACTIONS = [
  "open_operations_queue",
  "send_public_status_update",
  "create_support_ticket",
  "export_governance_identifiers",
  "disable_production_payments",
  "review_data_handoff",
  "submit_manual_request",
  "view_governance_report",
  "draft_policy_constrained_message",
] as const;
const APPROVAL_GOVERNED_ACTIONS = ["issue_large_refund"] as const;
const HANDOFF_CHOICES = ["minimal", "growth", "sensitive"] as const;
const SENSITIVITY_VALUES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

const GovernedActionSchema = z.enum(GOVERNED_ACTIONS);
const DirectGovernedActionSchema = z.enum(DIRECT_GOVERNED_ACTIONS);
const ApprovalGovernedActionSchema = z.enum(APPROVAL_GOVERNED_ACTIONS);

const nullableString = (description: string) =>
  z.union([z.string(), z.null()]).optional().describe(description);
const nullableNumber = (description: string) =>
  z.union([z.number(), z.null()]).optional().describe(description);
const nullableBoolean = (description: string) =>
  z.union([z.boolean(), z.null()]).optional().describe(description);
const nullableStringArray = (description: string) =>
  z
    .union([z.array(z.string()), z.null()])
    .optional()
    .describe(description);
const nullableSensitivity = (description: string) =>
  z
    .union([z.enum(SENSITIVITY_VALUES), z.null()])
    .optional()
    .describe(description);
const nullableHandoffChoice = (description: string) =>
  z
    .union([z.enum(HANDOFF_CHOICES), z.null()])
    .optional()
    .describe(description);

export const openbox_governed_action = tool(
  async (
    input: {
      action: z.infer<typeof DirectGovernedActionSchema>;
      request?: string | null;
      destination?: string | null;
      amountUsd?: number | null;
      fields?: string[] | null;
      audience?: string | null;
      manualInput?: string | null;
      sensitivity?:
        | "public"
        | "internal"
        | "confidential"
        | "restricted"
        | null;
      choiceId?: "minimal" | "growth" | "sensitive" | null;
    },
    config,
  ) => {
    const request = requireRequest(dropNullValues(input));
    return timeTool("openbox_governed_action", async () => {
      return JSON.stringify(await governAction(request, config));
    });
  },
  {
    name: "openbox_governed_action",
    description:
      "Execute a realistic business action for the OpenBox governance demo. " +
      "Always pass a non-empty JSON object with action and request. Never call this tool with empty arguments. " +
      'Example: {"action":"open_operations_queue","request":"Review this operations queue and tell me what can move forward: resend a customer invoice, follow up on a dashboard refresh delay, close a duplicate support ticket, and schedule a vendor review call."}. ' +
      "Use open_operations_queue for governed operations queue reviews, " +
      "send_public_status_update for harmless summaries or outbound status updates, " +
      "create_support_ticket for normal internal operations, export_governance_identifiers for internal identifier exports or external sharing, " +
      "and disable_production_payments for destructive production/payment shutdowns. " +
      "Use review_data_handoff after an OpenBox interactive choice UI returns final vendor-review data-sharing choices, " +
      "submit_manual_request after an OpenBox manual input UI returns user-entered text, view_governance_report for governance reports that may need redaction, " +
      "and draft_policy_constrained_message for generated drafts that may need constrained/redacted output. " +
      "When the previous tool result is JSON from openboxInteractiveReview, call this tool immediately with that payload. " +
      "Call this tool for natural OpenBox governance requests and let OpenBox decide whether the action proceeds.",
    schema: z.object({
      action: z
        .enum(DIRECT_GOVERNED_ACTIONS)
        .describe(
          "Required OpenBox business action to govern before execution.",
        ),
      request: z
        .string()
        .min(1)
        .describe(
          "Required. Copy the user's current natural-language request.",
        ),
      destination: nullableString(
        "Destination when applicable; otherwise null.",
      ),
      amountUsd: nullableNumber(
        "Dollar amount when applicable; otherwise null.",
      ),
      fields: nullableStringArray(
        "Requested fields when applicable; otherwise null.",
      ),
      audience: nullableString("Audience when applicable; otherwise null."),
      manualInput: nullableString(
        "Final user-edited text when applicable; otherwise null.",
      ),
      sensitivity: nullableSensitivity(
        "Sensitivity when applicable; otherwise null.",
      ),
      choiceId: nullableHandoffChoice(
        "Selected handoff choice when applicable; otherwise null.",
      ),
    }),
  },
);

export const openbox_governed_approval_action = tool(
  async (
    input: {
      action: z.infer<typeof ApprovalGovernedActionSchema>;
      request?: string | null;
      destination?: string | null;
      amountUsd?: number | null;
    },
    config,
  ) => {
    const request = requireRequest(dropNullValues(input));
    return timeTool("openbox_governed_approval_action", async () => {
      return JSON.stringify(await governAction(request, config));
    });
  },
  {
    name: "openbox_governed_approval_action",
    description:
      "Start an OpenBox-governed business action that may require CopilotKit human approval. " +
      "Always pass action, request, and amountUsd when money movement is requested. Never call this tool with empty arguments. " +
      'Example: {"action":"issue_large_refund","request":"Issue a $7,500 service credit to the approved account.","amountUsd":7500}. ' +
      "Use issue_large_refund for refunds, credits, payouts, invoice write-offs, or other money movement. " +
      "If this returns approval_required, call openboxApprovalReview, then openbox_resume_governed_action.",
    schema: z.object({
      action: z
        .enum(APPROVAL_GOVERNED_ACTIONS)
        .describe("Required approval-gated OpenBox business action."),
      request: z
        .string()
        .min(1)
        .describe(
          "Required. Copy the user's current natural-language request.",
        ),
      destination: nullableString(
        "Destination when applicable; otherwise null.",
      ),
      amountUsd: z
        .number()
        .positive()
        .describe(
          "Required dollar amount for the approval-gated money movement.",
        ),
    }),
  },
);

export const openbox_resume_governed_action = tool(
  async (
    input: {
      workflowId: string;
      runId: string;
      activityId: string;
      approvalId?: string | null;
      governanceEventId?: string | null;
      approved?: boolean | null;
      action: z.infer<typeof GovernedActionSchema>;
      request: string;
      destination?: string | null;
      amountUsd?: number | null;
      fields?: string[] | null;
      audience?: string | null;
      manualInput?: string | null;
      sensitivity?:
        | "public"
        | "internal"
        | "confidential"
        | "restricted"
        | null;
      choiceId?: "minimal" | "growth" | "sensitive" | null;
    },
    config,
  ) => {
    const normalizedInput = dropNullValues(input);
    return timeTool("openbox_resume_governed_action", async () => {
      return JSON.stringify(
        await resumeGovernedAction(normalizedInput, config),
      );
    });
  },
  {
    name: "openbox_resume_governed_action",
    description:
      "Resume a governed OpenBox business action after the CopilotKit approval UI returns a decision. " +
      "Always call this after openboxApprovalReview returns, even when the user rejected. " +
      "This tool polls OpenBox Core and only executes the action if OpenBox returns allow.",
    schema: z.object({
      workflowId: z.string(),
      runId: z.string(),
      activityId: z.string(),
      approvalId: nullableString(
        "OpenBox approval id when present; otherwise null.",
      ),
      governanceEventId: nullableString(
        "OpenBox governance event id when present; otherwise null.",
      ),
      approved: nullableBoolean(
        "Approval decision when present; otherwise null.",
      ),
      action: z.enum(GOVERNED_ACTIONS),
      request: z.string(),
      destination: nullableString(
        "Destination when applicable; otherwise null.",
      ),
      amountUsd: nullableNumber(
        "Dollar amount when applicable; otherwise null.",
      ),
      fields: nullableStringArray(
        "Requested fields when applicable; otherwise null.",
      ),
      audience: nullableString("Audience when applicable; otherwise null."),
      manualInput: nullableString(
        "Final user-edited text when applicable; otherwise null.",
      ),
      sensitivity: nullableSensitivity(
        "Sensitivity when applicable; otherwise null.",
      ),
      choiceId: nullableHandoffChoice(
        "Selected handoff choice when applicable; otherwise null.",
      ),
    }),
  },
);

async function timeTool<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  console.info(`[openbox-demo] ${name} started`);
  try {
    return await fn();
  } finally {
    console.info(
      `[openbox-demo] ${name} finished in ${Date.now() - startedAt}ms`,
    );
  }
}

function requireRequest<
  T extends { action: z.infer<typeof GovernedActionSchema>; request?: string },
>(input: T): T & { request: string } {
  const request = input.request?.trim();
  if (!request) {
    throw new Error("OpenBox governed tools require the current user request.");
  }
  return { ...input, request };
}

function dropNullValues<T extends Record<string, unknown>>(input: T): any {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null),
  );
}
