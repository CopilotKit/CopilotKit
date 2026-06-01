"use client";

// @region[hitl-hook]
import {
  CopilotKitProvider,
  CopilotChat,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function HITL() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useHumanInTheLoop({
    name: "approveAction",
    description:
      "Ask the user to approve a sensitive action before running it.",
    parameters: z.object({
      action: z.string().describe("Short name of the action to approve"),
      reason: z.string().describe("Why the agent wants to do this"),
    }),
    render: ApprovalCard,
  });
  // @endregion[hitl-hook]

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">In-Chat Human in the Loop</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;Delete the README; it&rsquo;s outdated.&rdquo; The agent
        will ask you to approve the action inline.
      </p>
      <CopilotChat />
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ApprovalCard(props: any) {
  const { status, args, respond, result } = props;
  const action = args?.action ?? "(pending)";
  const reason = args?.reason ?? "";

  if (status === "InProgress") {
    return (
      <div className="border rounded p-3 my-2 opacity-70">
        <div className="font-medium">Preparing approval — {action}</div>
        {reason ? <div className="text-sm">{reason}</div> : null}
      </div>
    );
  }

  if (status === "Executing" && respond) {
    return (
      <div className="border rounded p-3 my-2">
        <div className="font-medium">Approve action: {action}</div>
        <div className="text-sm opacity-70">{reason}</div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="px-3 py-1 bg-green-600 text-white rounded"
            onClick={() => respond({ approved: true })}
          >
            Approve
          </button>
          <button
            type="button"
            className="px-3 py-1 bg-red-600 text-white rounded"
            onClick={() => respond({ approved: false })}
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  // Complete
  return (
    <div className="border rounded p-3 my-2 opacity-70">
      <div className="font-medium">Decision recorded — {action}</div>
      <div className="text-sm">
        {typeof result === "string" ? result : JSON.stringify(result)}
      </div>
    </div>
  );
}
