"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  ToolCallStatus,
  useAgentContext,
  useCopilotChatConfiguration,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { useParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { findDeal } from "@/lib/deals";
import type { Deal } from "@/lib/deals";

const approveDealArgs = z.object({ dealId: z.string(), amount: z.number() });

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const deal = findDeal(id);
  if (deal === undefined) return <p>Unknown deal.</p>;

  return (
    <CopilotChatConfigurationProvider agentId="default">
      <DealView deal={deal} />
    </CopilotChatConfigurationProvider>
  );
}

function DealView({ deal }: { deal: Deal }) {
  const config = useCopilotChatConfiguration();
  const [approvedHere, setApprovedHere] = useState(false);

  useAgentContext({
    description: "The deal the user is looking at",
    value: { dealId: deal.id, amount: deal.amount },
  });

  useHumanInTheLoop({
    name: "approveDeal",
    description: "Ask the user to approve or reject the deal",
    parameters: approveDealArgs,
    render: ({ args, status, respond, result }) => {
      if (status === ToolCallStatus.Complete) {
        return (
          <p className="text-sm text-gray-600">
            Decision recorded: {String(result)}
          </p>
        );
      }
      return (
        <div className="my-2 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm">
            Approve {args.dealId} for ${args.amount?.toLocaleString("en-US")}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-copilotkit-action="hitl.approve"
              disabled={respond === undefined}
              onClick={() => respond?.("approved")}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              data-copilotkit-action="hitl.reject"
              disabled={respond === undefined}
              onClick={() => respond?.("rejected")}
              className="rounded bg-gray-200 px-3 py-1 text-sm disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      );
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <h1 className="mb-1 text-2xl font-semibold">{deal.name}</h1>
        <p className="mb-4 text-gray-500">
          ${deal.amount.toLocaleString("en-US")} · {deal.stage}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-copilotkit-action="deal.approve"
            onClick={() => setApprovedHere(true)}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
          >
            {approvedHere ? "Approved" : "Approve without the agent"}
          </button>
          <button
            type="button"
            data-copilotkit-action="thread.new"
            onClick={() => config?.startNewThread()}
            className="rounded border px-3 py-1.5 text-sm"
          >
            New thread
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Open thread: <code>{config?.threadId}</code>
        </p>
      </section>
      <section className="h-[600px] rounded border">
        <CopilotChat />
      </section>
    </div>
  );
}
