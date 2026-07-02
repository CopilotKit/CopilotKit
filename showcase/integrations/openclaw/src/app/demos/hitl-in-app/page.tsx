"use client";

// @region[frontend-tool]
// @region[frontend-tool-registration]
import { useState } from "react";
import {
  CopilotKit,
  CopilotPopup,
  useAgentContext,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ApprovalDialog, PendingApproval } from "./approval-dialog";
import { TicketsPanel } from "./tickets-panel";
import { useHitlInAppSuggestions } from "./suggestions";

export default function HitlInAppDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="hitl-in-app">
      <Layout />
    </CopilotKit>
  );
}

// @region[resolve-type]
// Internal state shape: the args the agent passed plus the `resolve`
// fn we captured from the Promise returned by the tool handler.
type ResolveFn = (value: { approved: boolean; reason?: string }) => void;
type DialogState =
  | { open: false }
  | { open: true; pending: PendingApproval; resolve: ResolveFn };
// @endregion[resolve-type]

function Layout() {
  const [dialog, setDialog] = useState<DialogState>({ open: false });

  useHitlInAppSuggestions();

  // @region[agent-steering]
  // Per-demo steering delivered to the agent as AG-UI context (the clawg-ui
  // adapter appends context entries to the OpenClaw agent prompt). One shared
  // agent; the instruction lives with the demo that needs it.
  useAgentContext({
    description: "Operating instructions for this demo",
    value:
      "You are a support-operations copilot working alongside a human operator. " +
      "Before approving, processing, or otherwise acting on any consequential " +
      "request (refunds, credits, closing tickets, deletions), you MUST call the " +
      "request_user_approval tool to obtain the operator's decision. Treat the " +
      "returned { approved, reason } as authoritative: if approved, confirm " +
      "concisely; if not, stop. Never decline by claiming you lack access to a " +
      "system — the approval tool is your mechanism to act.",
  });
  // @endregion[agent-steering]

  useFrontendTool({
    name: "request_user_approval",
    description:
      "Ask the operator to approve or reject an action before you take it. " +
      "The operator will respond via an in-app modal dialog that appears " +
      "OUTSIDE the chat surface. The tool returns an object of the shape " +
      "{ approved: boolean, reason?: string }.",
    parameters: z.object({
      message: z
        .string()
        .describe(
          "Short summary of the action needing approval (include concrete numbers / IDs).",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Optional extra context — e.g. the ticket ID or policy rule.",
        ),
    }),
    // @region[frontend-tool-handler]
    handler: async ({
      message,
      context,
    }: {
      message: string;
      context?: string;
    }) => {
      // Return a Promise whose `resolve` we stash into state. The modal
      // dialog calls `resolve(...)` when the user clicks Approve / Reject,
      // which completes THIS handler and hands the value back to the
      // agent as the tool result.
      return await new Promise<{ approved: boolean; reason?: string }>(
        (resolve) => {
          setDialog({ open: true, pending: { message, context }, resolve });
        },
      );
    },
    // @endregion[frontend-tool-handler]
  });
  // @endregion[frontend-tool-registration]
  // @endregion[frontend-tool]

  const handleResolve = (result: { approved: boolean; reason?: string }) => {
    if (dialog.open) {
      dialog.resolve(result);
      setDialog({ open: false });
    }
  };

  return (
    <div className="h-screen bg-gray-50">
      <TicketsPanel />
      <CopilotPopup
        agentId="hitl-in-app"
        defaultOpen={true}
        labels={{
          chatInputPlaceholder: "Type a message",
        }}
      />
      {dialog.open && (
        <ApprovalDialog pending={dialog.pending} onResolve={handleResolve} />
      )}
    </div>
  );
}
