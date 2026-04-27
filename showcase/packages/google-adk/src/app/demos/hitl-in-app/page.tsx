"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
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
  const [pending, setPending] = useState<ApprovalRequest | null>(null);

  // useFrontendTool with an async handler — agent awaits the user's
  // decision via a resolved Promise. The tool returns whatever the user
  // clicks; the agent then continues its turn with that result.
  useFrontendTool({
    name: "request_approval",
    description:
      "Request user approval before performing a sensitive action. Pass a short summary of the action and a reason. Returns { accepted, reason? }.",
    parameters: z.object({
      summary: z.string().describe("Short summary of the proposed action."),
      reason: z.string().describe("Why the action is being proposed."),
    }),
    handler: async ({ summary, reason }: { summary: string; reason: string }) => {
      const decision = await new Promise<{ accepted: boolean; reason?: string }>(
        (resolve) => {
          setPending({
            id: crypto.randomUUID(),
            summary,
            reason,
            resolve: (d) => {
              setPending(null);
              resolve(d);
            },
          });
        },
      );
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
    ],
    available: "always",
  });

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
      {pending && <ApprovalDialog request={pending} />}
    </div>
  );
}
