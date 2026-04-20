"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useInterrupt,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { InterruptCard, InterruptPayload } from "./InterruptCard";

// Outer layer — provider + layout chrome.
export default function GenUiInterruptDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-interrupt">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// The actual view — chat + an in-chat interrupt UI.
function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Book a flight",
        message: "Book me a flight from SFO to JFK next Friday.",
      },
      {
        title: "Delete my account",
        message: "Please delete my account — I know, this needs confirmation.",
      },
    ],
    available: "always",
  });

  useInterrupt({
    agentId: "gen-ui-interrupt",
    renderInChat: true,
    render: ({ event, resolve }) => (
      <InterruptCard
        payload={(event.value ?? {}) as InterruptPayload}
        onApprove={() => resolve({ approved: true })}
        onCancel={() => resolve({ approved: false })}
      />
    ),
  });

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
