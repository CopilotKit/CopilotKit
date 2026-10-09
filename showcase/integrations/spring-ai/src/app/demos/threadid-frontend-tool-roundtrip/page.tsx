"use client";

import React, { useState } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

const AGENT_ID = "threadid-frontend-tool-roundtrip";
const FIXED_THREAD_ID = "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580";

function ThreadIdRoundTripChat() {
  const [explicitThreadId, setExplicitThreadId] = useState(false);

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <h1 className="text-base font-semibold">
            Frontend Tool Thread Round Trip
          </h1>
          <p
            className="mt-1 text-sm text-slate-300"
            data-testid="ent-658-thread-mode"
          >
            {explicitThreadId ? "Explicit thread" : "SDK-generated thread"}
          </p>
        </div>
        <label className="flex items-center gap-3 text-sm text-slate-100">
          <input
            aria-label="Explicit threadId"
            checked={explicitThreadId}
            className="h-4 w-4 accent-cyan-400"
            onChange={(event) => setExplicitThreadId(event.target.checked)}
            type="checkbox"
          />
          Explicit threadId
        </label>
      </div>

      <div className="min-h-0 flex-1 px-6 py-5">
        <CopilotChatConfigurationProvider
          key={explicitThreadId ? "explicit-thread" : "generated-thread"}
          agentId={AGENT_ID}
          {...(explicitThreadId
            ? { threadId: FIXED_THREAD_ID, hasExplicitThreadId: true }
            : {})}
        >
          <FrontendToolRegistration />
          <CopilotChat
            agentId={AGENT_ID}
            className="h-full rounded-2xl border border-white/10 bg-white text-slate-950"
            welcomeScreen={false}
          />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

function FrontendToolRegistration() {
  useFrontendTool({
    name: "testFrontendToolCalling",
    description: "Return the label that was supplied by the user.",
    parameters: z.object({
      label: z.string().describe("The label to echo in the tool result."),
    }),
    followUp: true,
    handler: async ({ label }) => `handled ${label}`,
    render: ({ args, result }) => (
      <div
        className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950"
        data-testid="ent-658-tool-card"
      >
        <div className="font-semibold">testFrontendToolCalling</div>
        <div>label: {args.label}</div>
        <div>result: {String(result ?? "pending")}</div>
      </div>
    ),
  });

  return null;
}

export default function ThreadIdFrontendToolRoundTripDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <ThreadIdRoundTripChat />
    </CopilotKit>
  );
}
