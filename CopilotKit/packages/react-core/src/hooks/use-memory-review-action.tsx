import React from "react";
import { useCopilotAction } from "./use-copilot-action";
import { CopilotRequestType } from "@copilotkit/runtime-client-gql";
import { useCopilotContext } from "../context/copilot-context";

/**
 * Registers a frontend-only action `propose_memory_update` that renders an inline accept/decline UI
 * and, on accept/decline, commits the change via the runtime-local memory tools.
 *
 * This keeps memory review in the chat UX using the recommended frontend action flow.
 */
export function useMemoryReviewAction() {
  const { runtimeClient, forwardedParameters, threadId, runId } = useCopilotContext();

  useCopilotAction({
    name: "propose_memory_update",
    description:
      "Propose a durable user fact update. Use when the user states or confirms a lasting preference or attribute.",
    parameters: [
      { name: "fact_key", type: "string" },
      { name: "value", type: "any" },
      { name: "confidence", type: "number", required: false },
      { name: "reason", type: "string", required: false },
    ],
    // Render inline UI and wait for user decision
    renderAndWaitForResponse: ({ args, respond }) => {
      const prettyName = args.fact_key?.replace(/\./g, ": ") ?? "preference";
      const prettyValue = typeof args.value === "string" ? args.value : JSON.stringify(args.value);
      return (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            Save memory: {prettyName} → <b>{prettyValue}</b>?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => respond({ decision: "accept" })}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#eef6ff",
                color: "#1d4ed8",
                cursor: "pointer",
              }}
            >
              Accept
            </button>
            <button
              onClick={() => respond({ decision: "reject" })}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                color: "#374151",
                cursor: "pointer",
              }}
            >
              Discard
            </button>
          </div>
        </div>
      );
    },
    // After the user decides, commit to runtime memory tools (local-only) in the background
    handler: async ({ fact_key, value, confidence }) => {
      const toolName = value === null || value === undefined ? "memory_delete" : "memory_upsert";
      const args =
        toolName === "memory_upsert"
          ? { fact_key, value, confidence: confidence ?? 0.9 }
          : { fact_key };

      try {
        // Fire-and-forget background request that executes the local runtime tool
        void runtimeClient.generateCopilotResponse({
          metadata: { requestType: CopilotRequestType.Task },
          frontend: {
            actions: [],
            url: typeof window !== "undefined" ? window.location.origin : "http://localhost/unused",
          },
          messages: [],
          forwardedParameters: {
            ...(forwardedParameters || {}),
            toolChoice: "function",
            // @ts-expect-error string literal accepted at runtime
            toolChoiceFunctionName: toolName,
          },
          threadId: threadId || undefined,
          runId: runId || undefined,
          agentSession: undefined,
          agentStates: undefined,
        });
      } catch (_e) {
        // Non-blocking; the chat flow continues regardless
      }

      // Return a concise result for the LLM trace
      return { acknowledged: true };
    },
  });
}
