"use client";

import React, { use } from "react";
import {
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";

const DEMO_ID = "shared-state-streaming";

export default function SharedStateStreamingDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
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
        title: "Add birthday tasks",
        message: "Add five tasks for a birthday party.",
      },
      {
        title: "Create a project plan",
        message: "Create a detailed project plan.",
      },
      {
        title: "Meal prep tasks",
        message: "Generate a week's worth of meal prep tasks.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId={DEMO_ID}
      className="h-full rounded-2xl"
      labels={{
        chatInputPlaceholder: "Ask the agent to create a list...",
      }}
    />
  );
}
