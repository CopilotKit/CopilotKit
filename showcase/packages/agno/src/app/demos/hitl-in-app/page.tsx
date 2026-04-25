"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ApprovalDialog, PendingApproval } from "./approval-dialog";

const SUPPORT_TICKETS = [
  {
    id: "#12345",
    customer: "Jordan Rivera",
    subject: "Refund request — duplicate charge",
    status: "Open",
    amount: 50,
  },
  {
    id: "#12346",
    customer: "Priya Shah",
    subject: "Downgrade plan to Starter",
    status: "Open",
    amount: 0,
  },
  {
    id: "#12347",
    customer: "Morgan Lee",
    subject: "Escalate: payment stuck in pending",
    status: "Escalating",
    amount: 0,
  },
];

export default function HitlInAppDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="hitl-in-app">
      <Layout />
    </CopilotKit>
  );
}

type ResolveFn = (value: { approved: boolean; reason?: string }) => void;
type DialogState =
  | { open: false }
  | { open: true; pending: PendingApproval; resolve: ResolveFn };

function Layout() {
  const [dialog, setDialog] = useState<DialogState>({ open: false });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Approve refund for #12345",
        message:
          "Please approve a $50 refund to Jordan Rivera on ticket #12345 for the duplicate charge.",
      },
      {
        title: "Downgrade plan for #12346",
        message:
          "Please downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle.",
      },
      {
        title: "Escalate ticket #12347",
        message:
          "Please escalate ticket #12347 to the payments team — Morgan Lee's payment is stuck.",
      },
    ],
    available: "always",
  });

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
    handler: async ({
      message,
      context,
    }: {
      message: string;
      context?: string;
    }) => {
      return await new Promise<{ approved: boolean; reason?: string }>(
        (resolve) => {
          setDialog({ open: true, pending: { message, context }, resolve });
        },
      );
    },
  });

  const handleResolve = (result: { approved: boolean; reason?: string }) => {
    if (dialog.open) {
      dialog.resolve(result);
      setDialog({ open: false });
    }
  };

  return (
    <div className="grid h-screen grid-cols-[1fr_420px] bg-gray-50">
      <TicketsPanel />
      <div className="border-l border-gray-200 bg-white">
        <CopilotChat agentId="hitl-in-app" className="h-full" />
      </div>
      {dialog.open && (
        <ApprovalDialog pending={dialog.pending} onResolve={handleResolve} />
      )}
    </div>
  );
}

function TicketsPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Support Inbox
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Open tickets</h1>
        <p className="mt-1 text-sm text-gray-600">
          Ask the copilot to take an action. Every customer-affecting action
          will pop up an approval dialog here in the app — outside the chat.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <ul className="space-y-3">
          {SUPPORT_TICKETS.map((t) => (
            <li
              key={t.id}
              data-testid={`ticket-${t.id.replace("#", "")}`}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-gray-500">{t.id}</span>
                <span
                  className={
                    t.status === "Escalating"
                      ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                      : "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                  }
                >
                  {t.status}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900">
                {t.customer}
              </div>
              <div className="text-sm text-gray-700">{t.subject}</div>
              {t.amount > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  Disputed amount: ${t.amount.toFixed(2)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
