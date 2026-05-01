"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

import { ApprovalDialog, ApprovalRequest } from "./approval-dialog";

export default function HitlInAppDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="hitl_in_app">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // Queue of in-flight approval requests rather than a single-slot ref.
  // Gemini's parallel-tool-call paths can fire `request_approval` more
  // than once before the first resolves; the previous single-slot
  // `useState<ApprovalRequest | null>` orphaned the first promise on
  // any second call, leaving the agent waiting on a tool result that
  // never arrived. We render the head of the queue, advance on each
  // user decision, and let every Promise resolve in arrival order.
  const [pendingQueue, setPendingQueue] = useState<ApprovalRequest[]>([]);

  // Mirror the queue in a ref so the unmount cleanup can read the current
  // set of in-flight resolves without re-registering the cleanup on every
  // queue change. Without this, navigating away while approvals are pending
  // leaves the agent's tool-call promises orphaned forever.
  const pendingQueueRef = useRef<ApprovalRequest[]>([]);
  useEffect(() => {
    pendingQueueRef.current = pendingQueue;
  }, [pendingQueue]);
  useEffect(() => {
    return () => {
      // Reject every still-pending approval with a rejection (not "approved
      // by default") so the agent's tool result reflects the user's actual
      // navigation away. The agent's instruction handles `accepted: false`;
      // this surfaces as "user cancelled" in the agent's next turn rather
      // than as a tool-call hang.
      for (const r of pendingQueueRef.current) {
        r.resolve({
          accepted: false,
          reason: "user navigated away before responding",
        });
      }
    };
  }, []);

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
      const requestId = crypto.randomUUID();
      const decision = await new Promise<{
        accepted: boolean;
        reason?: string;
      }>((resolve) => {
        setPendingQueue((prev) => [
          ...prev,
          {
            id: requestId,
            summary: message,
            reason: context ?? "",
            resolve: (d) => {
              // Drop our own entry from the queue, then resolve. Filter
              // by id so concurrent resolves don't accidentally drop
              // each other.
              setPendingQueue((q) => q.filter((r) => r.id !== requestId));
              resolve(d);
            },
          },
        ]);
      });
      return decision;
    },
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Charge customer",
        message: "I want to charge the customer $100 for the upgrade.",
      },
      {
        title: "Delete record",
        message: "Delete the duplicate user record for atai@example.com.",
      },
      // @region[canonical-e2e-suggestion]
      // Canonical e2e suggestion — single pill keyed to the aimock fixture in
      // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
      {
        title: "Refund approval",
        message: "process a refund for the late delivery ticket",
      },
      // @endregion[canonical-e2e-suggestion]
    ],
    available: "always",
  });

  // Render only the head of the queue; subsequent approvals are answered
  // in arrival order as the user dispatches each decision.
  const head = pendingQueue[0];

  return (
    <div className="flex justify-center items-center h-screen w-full bg-gray-50">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="hitl_in_app"
          className="h-full rounded-2xl"
          labels={{
            chatInputPlaceholder:
              "Ask the agent to do something that needs approval...",
          }}
        />
      </div>
      {/* `key` on ApprovalDialog forces remount per request so any local
          UI state added in the future (a "reason" textarea, etc.) does
          not leak from one approval into the next as the head rotates. */}
      {head && <ApprovalDialog key={head.id} request={head} />}
    </div>
  );
}
