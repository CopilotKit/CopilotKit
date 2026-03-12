import { useEffect } from "react";
import type { TicketMeta } from "../lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useCopilotAction } from "@copilotkit/react-core";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "v2 afterRequestMiddleware: no access to output messages",
  refs: [
    "https://copilotkit.slack.com/archives/C09C1BLEPC1/p1769639928266649",
  ],
  notes:
    "In v1, onAfterRequest middleware received outputMessages: Message[] for telemetry. " +
    "In v2, afterRequestMiddleware only receives a Response object whose body has " +
    "already been consumed (streamed to client). No way to inspect assistant " +
    "output for logging, analytics, or action tracking.\n\n" +
    "Send any message and check the SERVER terminal for [tkt-v2-after-mw server] logs " +
    "showing the middleware attempting (and failing) to read the response body.",
};

// ---------------------------------------------------------------------------
// Inner component — lives inside <CopilotKit> so hooks work
// ---------------------------------------------------------------------------

function TktV2AfterMwInner() {
  console.log("[tkt-v2-after-mw] Inner component mounted");

  // Register a simple action so the agent's tool call flows through the runtime
  useCopilotAction({
    name: "logTelemetry",
    description: "Log telemetry data from the conversation",
    parameters: [
      { name: "event", type: "string", description: "Event name", required: true },
      { name: "data", type: "string", description: "Event data", required: true },
    ],
    handler: async ({ event, data }) => {
      console.log("[tkt-v2-after-mw] logTelemetry action called:", { event, data });
      return `Logged: ${event}`;
    },
  });

  useEffect(() => {
    console.log("[tkt-v2-after-mw] Component ready — send a message to trigger the agent.");
    console.log("[tkt-v2-after-mw] Watch the SERVER terminal for afterRequestMiddleware logs.");
  }, []);

  return (
    <div className="flex flex-col h-[600px]">
      <div className="p-4 bg-amber-50 border-b border-amber-200">
        <h3 className="font-semibold text-amber-800 mb-2">
          afterRequestMiddleware: Response body consumed
        </h3>
        <p className="text-sm text-amber-700 mb-2">
          Send any message below. The server's <code className="bg-amber-100 px-1 rounded">afterRequestMiddleware</code>{" "}
          will attempt to read the response body for telemetry. Check the <strong>server terminal</strong>{" "}
          for <code className="bg-amber-100 px-1 rounded">[tkt-v2-after-mw server]</code> logs showing the failure.
        </p>
        <div className="text-xs text-amber-600 space-y-1 mt-2">
          <p>
            <strong>v1 (worked):</strong> <code>onAfterRequest</code> received{" "}
            <code>{`{ outputMessages: Message[], inputMessages, threadId, runId }`}</code>
          </p>
          <p>
            <strong>v2 (gap):</strong> <code>afterRequestMiddleware</code> receives{" "}
            <code>{`{ response: Response, runtime, path }`}</code> — body already consumed
          </p>
        </div>
      </div>
      <div className="flex-1 relative">
        <CopilotChat
          labels={{
            modalHeaderTitle: "v2 Middleware Gap",
            welcomeMessageText:
              "Send any message (e.g. \"What's the weather in NYC?\"). " +
              "Then check the server terminal for afterRequestMiddleware logs.",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ticket component — wraps with CopilotKit provider
// ---------------------------------------------------------------------------

export default function TktV2AfterMw() {
  console.log("[tkt-v2-after-mw] Mounting with v2 CopilotRuntime endpoint");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        v2 afterRequestMiddleware: no access to output messages
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        In v1, <code>onAfterRequest</code> middleware provided direct access to{" "}
        <code>outputMessages: Message[]</code> for inspecting assistant responses,
        tracking action execution, and logging telemetry. In v2,{" "}
        <code>afterRequestMiddleware</code> only provides the raw{" "}
        <code>Response</code> object whose body (SSE stream) has already been
        consumed by the time middleware runs.
      </p>

      <div className="border rounded-lg overflow-hidden">
        <CopilotKit
          runtimeUrl="/api/tickets/tkt-v2-after-mw/copilot"
          agent="default"
          useSingleEndpoint
        >
          <TktV2AfterMwInner />
        </CopilotKit>
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
        <h3 className="font-semibold text-sm text-gray-700 mb-2">
          Source code pointers (Express variant)
        </h3>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>
            <code>express-single.ts:173</code> — <code>await sendFetchResponse(res, response)</code> consumes the body
          </li>
          <li>
            <code>express-single.ts:174</code> — <code>callAfterRequestMiddleware({"{"} runtime, response, path {"}"})</code> called after body consumed
          </li>
          <li>
            <code>middleware.ts:28-32</code> — <code>AfterRequestMiddlewareParameters</code> only has <code>{`{ runtime, response, path }`}</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
