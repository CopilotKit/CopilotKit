"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ApprovalCard } from "./approval-card";

export default function HitlInChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="hitl-in-chat">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Delete my account",
        message: "Please delete my account — the email is user@example.com.",
      },
      {
        title: "Clear all data",
        message: "Wipe all of my stored data.",
      },
    ],
    available: "always",
  });

  useHumanInTheLoop({
    agentId: "hitl-in-chat",
    name: "confirm_destructive_action",
    description:
      "Ask the user to approve or reject a destructive action before proceeding.",
    parameters: z.object({
      action: z
        .string()
        .describe("Short label of the action, e.g. 'delete account'"),
      target: z
        .string()
        .describe("What will be affected, e.g. the email or resource"),
    }),
    render: ({ args, status, respond }: any) => (
      <ApprovalCard args={args} status={status} respond={respond} />
    ),
  });

  return <CopilotChat agentId="hitl-in-chat" className="h-full rounded-2xl" />;
}
