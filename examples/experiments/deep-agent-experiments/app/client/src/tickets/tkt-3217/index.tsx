import type { TicketMeta } from "../lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "LangChainAdapter regression: Unknown provider 'undefined' (v1.50+)",
  refs: ["https://github.com/CopilotKit/CopilotKit/issues/3217"],
  notes:
    "CopilotRuntime wraps LangChainAdapter in BuiltInAgent, reading .provider/.model " +
    "(which don't exist) → 'undefined/undefined' → crash. Even if patched, BuiltInAgent " +
    "never calls serviceAdapter.process(), so chainFn is silently bypassed.",
};

// ---------------------------------------------------------------------------
// Inner component — CopilotKit hooks must be inside the provider
// ---------------------------------------------------------------------------

function ChatInner() {
  console.log("[tkt-3217] ChatInner mounted");

  return (
    <div className="relative h-[600px] w-full">
      <div className="p-4">
        <p className="text-sm text-gray-600">
          Send any message. The server uses{" "}
          <code className="bg-gray-100 px-1 rounded">LangChainAdapter</code> with a simple{" "}
          <code className="bg-gray-100 px-1 rounded">chainFn</code> that echoes back.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          <strong>Expected:</strong> The chainFn runs and echoes the message count.
        </p>
        <p className="text-sm text-red-600 mt-1">
          <strong>Actual:</strong> Crashes with{" "}
          <code className="bg-red-50 px-1 rounded">
            Unknown provider "undefined" in "undefined/undefined"
          </code>
        </p>
      </div>
      <CopilotChat
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "tkt-3217: LangChainAdapter",
          welcomeMessageText: "Send any message to trigger the LangChainAdapter regression.",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ticket component
// ---------------------------------------------------------------------------

export default function Tkt3217() {
  console.log("[tkt-3217] Tkt3217 mounted");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">LangChainAdapter Regression (v1.50+)</h2>
      <p className="text-sm text-gray-600 mb-4">
        This reproduces{" "}
        <a
          href="https://github.com/CopilotKit/CopilotKit/issues/3217"
          className="underline text-blue-600"
          target="_blank"
          rel="noopener noreferrer"
        >
          issue #3217
        </a>
        . The runtime reads <code>serviceAdapter.provider</code> / <code>serviceAdapter.model</code>{" "}
        to construct a model string for <code>BuiltInAgent</code>, but <code>LangChainAdapter</code>{" "}
        has neither property — producing <code>"undefined/undefined"</code>.
      </p>
      <p className="text-sm text-gray-500 mb-4">
        Check the server terminal for <code>[tkt-3217 server]</code> logs and the browser console
        for <code>[tkt-3217]</code> logs.
      </p>

      <div className="border rounded-lg overflow-hidden">
        <CopilotKit runtimeUrl="/api/tickets/tkt-3217/copilot">
          <ChatInner />
        </CopilotKit>
      </div>
    </div>
  );
}
