"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useInterrupt,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

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
    render: ({ event, resolve }) => {
      // The agent's interrupt payload shape is up to the agent. We defensively
      // pull a `message` string and optional `details` record, falling back to
      // a pretty-printed JSON dump so the demo still works for unknown shapes.
      const payload = (event.value ?? {}) as {
        message?: string;
        details?: Record<string, unknown>;
      };
      const message =
        typeof payload.message === "string"
          ? payload.message
          : "The agent is waiting for your confirmation to continue.";

      return (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm max-w-md"
          data-testid="interrupt-card"
        >
          <p className="text-sm font-semibold text-amber-900 mb-1">
            Confirmation required
          </p>
          <p className="text-sm text-amber-800 mb-3">{message}</p>

          {payload.details && (
            <pre className="text-xs bg-white/70 rounded-md p-2 mb-3 overflow-x-auto text-amber-900">
              {JSON.stringify(payload.details, null, 2)}
            </pre>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => resolve({ approved: true })}
              className="flex-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              data-testid="interrupt-approve"
            >
              Approve
            </button>
            <button
              onClick={() => resolve({ approved: false })}
              className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              data-testid="interrupt-reject"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    },
  });

  return (
    <CopilotChat agentId="gen-ui-interrupt" className="h-full rounded-2xl" />
  );
}
